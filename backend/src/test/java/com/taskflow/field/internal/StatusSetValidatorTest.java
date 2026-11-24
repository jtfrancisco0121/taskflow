package com.taskflow.field.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.taskflow.field.StatusGroup;
import com.taskflow.shared.TaskflowException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("STAT-1 status set rules")
class StatusSetValidatorTest {

  private static StatusService.StatusDraft draft(String name, StatusGroup group) {
    return new StatusService.StatusDraft(null, name, group, null);
  }

  private static String codeOf(List<StatusService.StatusDraft> drafts) {
    try {
      StatusService.validate(drafts);
    } catch (TaskflowException e) {
      return e.code();
    }
    return null;
  }

  @Test
  void aSetWithOneNotStartedAndOneDoneOrClosedIsValid() {
    assertThatCode(() ->
            StatusService.validate(
                List.of(
                    draft("open", StatusGroup.NOT_STARTED), draft("shipped", StatusGroup.DONE))))
        .doesNotThrowAnyException();
    assertThatCode(() ->
            StatusService.validate(
                List.of(
                    draft("open", StatusGroup.NOT_STARTED), draft("dropped", StatusGroup.CLOSED))))
        .doesNotThrowAnyException();
  }

  @Test
  void aSetWithoutNotStartedIsRefused() {
    assertThat(codeOf(List.of(draft("doing", StatusGroup.ACTIVE), draft("done", StatusGroup.DONE))))
        .isEqualTo("status.needs_not_started");
  }

  @Test
  void aSetWithoutDoneOrClosedIsRefused() {
    assertThat(
            codeOf(
                List.of(
                    draft("todo", StatusGroup.NOT_STARTED), draft("doing", StatusGroup.ACTIVE))))
        .isEqualTo("status.needs_done");
  }

  @Test
  void namesMustBeUniqueIgnoringCaseAndNotBlank() {
    assertThat(
            codeOf(
                List.of(draft("To Do", StatusGroup.NOT_STARTED), draft("to do", StatusGroup.DONE))))
        .isEqualTo("status.duplicate_name");
    assertThat(codeOf(List.of(draft(" ", StatusGroup.NOT_STARTED))))
        .isEqualTo("status.invalid_name");
  }

  @Test
  void sizeAndColorAreChecked() {
    assertThat(codeOf(List.of())).isEqualTo("status.invalid_set");
    List<StatusService.StatusDraft> tooMany = new ArrayList<>();
    for (int i = 0; i < 31; i++) {
      tooMany.add(draft("s" + i, i == 0 ? StatusGroup.NOT_STARTED : StatusGroup.DONE));
    }
    assertThat(codeOf(tooMany)).isEqualTo("status.invalid_set");
    assertThatThrownBy(() ->
            StatusService.validate(
                List.of(
                    new StatusService.StatusDraft(null, "a", StatusGroup.NOT_STARTED, "red"),
                    draft("b", StatusGroup.DONE))))
        .isInstanceOf(TaskflowException.class)
        .hasMessageContaining("Colors");
  }
}
