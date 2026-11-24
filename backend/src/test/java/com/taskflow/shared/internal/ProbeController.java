package com.taskflow.shared.internal;

import com.taskflow.shared.Idempotent;
import com.taskflow.shared.Ids;
import com.taskflow.shared.TaskflowException;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Test-only endpoints, hidden from the OpenAPI contract. */
@Hidden
@RestController
@RequestMapping("/api/v1/test/idem")
class ProbeController {

  static final CountDownLatch[] GATE = new CountDownLatch[2];

  private final JdbcTemplate jdbc;
  private final ProbeService service;

  @PersistenceContext private EntityManager em;

  ProbeController(JdbcTemplate jdbc, ProbeService service) {
    this.jdbc = jdbc;
    this.service = service;
  }

  /** GATE[0] counts down when a request is inside; GATE[1] releases it. */
  static void arm() {
    GATE[0] = new CountDownLatch(1);
    GATE[1] = new CountDownLatch(1);
  }

  record Req(String name, String kind) {}

  @Idempotent
  @PostMapping("/create")
  ResponseEntity<Map<String, Object>> create(@RequestBody Req req) {
    UUID id = Ids.newId();
    jdbc.update("INSERT INTO idem_effect (id, name) VALUES (?, ?)", id, req.name());
    if ("invalid".equals(req.kind())) {
      throw TaskflowException.badRequest("probe.invalid", "invalid on purpose");
    }
    return ResponseEntity.status(201)
        .header("Location", "/api/v1/test/idem/" + id)
        .body(Map.of("id", id, "name", req.name()));
  }

  @Idempotent
  @PostMapping("/slow")
  ResponseEntity<Map<String, Object>> slow(@RequestBody Req req) throws InterruptedException {
    if (GATE[0] != null) {
      GATE[0].countDown();
      GATE[1].await(10, TimeUnit.SECONDS);
    }
    return create(req);
  }

  @Idempotent
  @PostMapping("/service")
  ResponseEntity<Map<String, Object>> viaService(@RequestBody Req req) {
    UUID id = service.write(Ids.newId(), req.name(), "fail".equals(req.kind()));
    return ResponseEntity.status(201).body(Map.of("id", id));
  }

  /** Persists entities whose deferred insert violates a constraint at flush time. */
  @Idempotent
  @PostMapping("/flush")
  ResponseEntity<Map<String, Object>> flush(@RequestBody Req req) {
    UUID id = Ids.newId();
    switch (req.kind()) {
      case "unique" -> {
        em.persist(new IdemProbe(id, req.name(), null));
        em.persist(new IdemProbe(Ids.newId(), req.name(), null));
      }
      case "fk" -> em.persist(new IdemProbe(id, req.name(), Ids.newId()));
      default -> em.persist(new IdemProbe(id, req.name(), null));
    }
    return ResponseEntity.status(201).body(Map.of("id", id));
  }

  @Idempotent
  @PostMapping("/commit")
  ResponseEntity<Map<String, Object>> commit(@RequestBody Req req) {
    UUID id = Ids.newId();
    jdbc.update("INSERT INTO idem_effect (id, name) VALUES (?, ?)", id, req.name());
    if ("fail".equals(req.kind())) {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void beforeCommit(boolean readOnly) {
              throw new IllegalStateException("commit hook failed on purpose");
            }
          });
    }
    return ResponseEntity.status(201).body(Map.of("id", id));
  }

  @PostMapping("/plain")
  ResponseEntity<Map<String, Object>> plain(@RequestBody Req req) {
    UUID id = Ids.newId();
    jdbc.update("INSERT INTO idem_effect (id, name) VALUES (?, ?)", id, req.name());
    return ResponseEntity.status(201).body(Map.of("id", id));
  }
}
