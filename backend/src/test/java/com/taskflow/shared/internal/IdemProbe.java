package com.taskflow.shared.internal;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

/** Test-only entity with an assigned id: its insert is deferred until flush. */
@Entity
@Table(name = "idem_probe")
public class IdemProbe {

  @Id private UUID id;
  private String name;
  private UUID parentId;

  protected IdemProbe() {}

  IdemProbe(UUID id, String name, UUID parentId) {
    this.id = id;
    this.name = name;
    this.parentId = parentId;
  }
}
