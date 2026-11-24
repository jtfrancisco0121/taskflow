package com.taskflow.automation.internal;

import java.util.Locale;

/** Names are compared trimmed and case-insensitively. */
final class AutomationText {

  private AutomationText() {}

  static String norm(String s) {
    return s == null ? "" : s.strip().toLowerCase(Locale.ROOT);
  }
}
