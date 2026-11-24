package com.taskflow.shared;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("CAP-17 rank service")
class RankServiceTest {

  @Test
  void firstRankHasNoNeighbours() {
    RankService.Rank first = RankService.first();
    assertThat(first.value()).isNotBlank();
    assertThat(first.needsRebalance()).isFalse();
  }

  @Test
  void betweenIsStrictlyInsideTheInterval() {
    String a = RankService.first().value();
    String b = RankService.after(a).value();
    String mid = RankService.between(a, b).value();
    assertThat(mid).isGreaterThan(a).isLessThan(b);
  }

  @Test
  void beforeFirstSortsBeforeIt() {
    String first = RankService.first().value();
    String before = RankService.before(first).value();
    assertThat(before).isLessThan(first);
    assertThat(RankService.before(before).value()).isLessThan(before);
  }

  @Test
  void afterLastSortsAfterIt() {
    String last = RankService.first().value();
    for (int i = 0; i < 200; i++) {
      String next = RankService.after(last).value();
      assertThat(next).isGreaterThan(last);
      assertThat(next).doesNotEndWith("0");
      last = next;
    }
  }

  @Test
  void manyInsertsAtOneSpotKeepOrderAndRebalanceOnlyPastTheLimit() {
    String lo = RankService.first().value();
    String hi = RankService.after(lo).value();
    List<String> inserted = new ArrayList<>();
    boolean rebalanceSeen = false;
    for (int i = 0; i < 1000; i++) {
      RankService.Rank r = RankService.between(lo, hi);
      assertThat(r.value()).isNotNull();
      assertThat(r.value()).isGreaterThan(lo).isLessThan(hi);
      if (r.needsRebalance()) {
        assertThat(r.value().length()).isGreaterThan(RankService.MAX_LENGTH);
        rebalanceSeen = true;
        break;
      }
      assertThat(r.value().length()).isLessThanOrEqualTo(RankService.MAX_LENGTH);
      inserted.add(r.value());
      hi = r.value();
    }
    assertThat(rebalanceSeen).isTrue();
    List<String> sorted = new ArrayList<>(inserted);
    sorted.sort(String::compareTo);
    assertThat(inserted).isEqualTo(sorted.reversed());
  }

  @Test
  void equalOrInvertedBoundsSignalRebalanceInsteadOfReturningARank() {
    assertThat(RankService.between("V", "V")).isEqualTo(new RankService.Rank(null, true));
    assertThat(RankService.between("z", "V")).isEqualTo(new RankService.Rank(null, true));
  }

  @Test
  void spreadGivesStrictlyIncreasingShortRanks() {
    for (int n : new int[] {0, 1, 2, 61, 62, 63, 500, 5000}) {
      List<String> ranks = RankService.spread(n);
      assertThat(ranks).hasSize(n);
      for (int i = 1; i < n; i++) {
        assertThat(ranks.get(i)).isGreaterThan(ranks.get(i - 1));
      }
      ranks.forEach(r -> assertThat(r).doesNotEndWith("0").hasSizeLessThan(8));
    }
  }

  @Test
  void aRebalancedScopeAcceptsFurtherInserts() {
    List<String> ranks = RankService.spread(300);
    String between = RankService.between(ranks.get(10), ranks.get(11)).value();
    assertThat(between).isGreaterThan(ranks.get(10)).isLessThan(ranks.get(11));
    assertThat(RankService.after(ranks.get(299)).value()).isGreaterThan(ranks.get(299));
  }
}
