package com.taskflow.task.internal;

import com.taskflow.shared.Page;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class TaskSearchController {

  private final TaskSearchService service;

  TaskSearchController(TaskSearchService service) {
    this.service = service;
  }

  @GetMapping("/workspaces/{id}/search")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public Page<TaskSearchService.SearchHit> search(
      @PathVariable UUID id,
      @RequestParam String q,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return service.search(id, q, cursor, limit);
  }
}
