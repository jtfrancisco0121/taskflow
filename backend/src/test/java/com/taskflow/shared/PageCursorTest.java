package com.taskflow.shared;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("AD-17 paging")
class PageCursorTest {

  @Test
  void encodesAndDecodesParts() {
    String cursor = PageCursor.encode("2026-11-24", "abc");
    assertThat(cursor).doesNotContain("=").doesNotContain("+").doesNotContain("/");
    assertThat(PageCursor.decode(cursor, 2)).containsExactly("2026-11-24", "abc");
  }

  @Test
  void blankCursorMeansFirstPage() {
    assertThat(PageCursor.decode(null, 2)).isNull();
    assertThat(PageCursor.decode("", 2)).isNull();
  }

  @Test
  void garbageCursorIsABadRequest() {
    assertThatThrownBy(() -> PageCursor.decode("!!!", 2))
        .isInstanceOf(TaskflowException.class)
        .hasMessage("Invalid cursor");
    assertThatThrownBy(() -> PageCursor.decode(PageCursor.encode("only-one"), 2))
        .isInstanceOf(TaskflowException.class);
  }

  @Test
  void limitDefaultsAndClamps() {
    assertThat(PageCursor.limit(null)).isEqualTo(50);
    assertThat(PageCursor.limit(10)).isEqualTo(10);
    assertThat(PageCursor.limit(10_000)).isEqualTo(200);
    assertThatThrownBy(() -> PageCursor.limit(0)).isInstanceOf(TaskflowException.class);
  }

  @Test
  void pageCarriesACursorOnlyWhenThereIsMore() {
    Page<Integer> full = PageCursor.page(List.of(1, 2, 3), 2, i -> "c" + i);
    assertThat(full.items()).containsExactly(1, 2);
    assertThat(full.nextCursor()).isEqualTo("c2");
    Page<Integer> last = PageCursor.page(List.of(1, 2), 2, i -> "c" + i);
    assertThat(last.nextCursor()).isNull();
  }
}
