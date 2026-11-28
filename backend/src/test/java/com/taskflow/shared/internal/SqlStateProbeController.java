package com.taskflow.shared.internal;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Test-only: raises a real Postgres error with the given SQLSTATE through JdbcTemplate. */
@Hidden
@RestController
@RequestMapping("/api/v1/test/sqlstate")
class SqlStateProbeController {

  private final JdbcTemplate jdbc;

  SqlStateProbeController(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @PostMapping("/{state}")
  ResponseEntity<Void> raise(@PathVariable String state) {
    if (!state.matches("[0-9A-Z]{5}")) {
      return ResponseEntity.badRequest().build();
    }
    jdbc.execute("DO $$ BEGIN RAISE EXCEPTION 'probe' USING ERRCODE = '" + state + "'; END $$");
    return ResponseEntity.noContent().build();
  }
}
