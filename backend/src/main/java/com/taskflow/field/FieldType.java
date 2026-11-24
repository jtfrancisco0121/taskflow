package com.taskflow.field;

/** The custom field types (field-types.md). A field's type is fixed at creation. */
public enum FieldType {
  TEXT,
  LONG_TEXT,
  NUMBER,
  DATE,
  DROPDOWN,
  LABELS,
  CHECKBOX,
  URL,
  EMAIL,
  PEOPLE,
  RATING,
  PROGRESS;

  /** True for the types whose definition carries Options. */
  public boolean hasOptions() {
    return this == DROPDOWN || this == LABELS;
  }
}
