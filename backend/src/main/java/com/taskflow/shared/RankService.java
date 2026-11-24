package com.taskflow.shared;

import java.util.ArrayList;
import java.util.List;

/**
 * Pure base-62 fractional index (AD-10). Ranks are digit strings over 0-9A-Za-z, which sorts
 * correctly under COLLATE "C". A rank never ends with the zero digit.
 */
public final class RankService {

  public static final int MAX_LENGTH = 64;
  private static final String DIGITS =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  /**
   * A computed rank. {@code value} is null when the bounds were equal or inverted; {@code
   * needsRebalance} is then true. It is also true when the value is longer than {@link
   * #MAX_LENGTH}, in which case the caller should re-rank the scope.
   */
  public record Rank(String value, boolean needsRebalance) {}

  private RankService() {}

  public static Rank first() {
    return between(null, null);
  }

  public static Rank after(String last) {
    return between(last, null);
  }

  public static Rank before(String first) {
    return between(null, first);
  }

  /** A rank strictly between lo and hi; either bound may be null (open). */
  public static Rank between(String lo, String hi) {
    String a = lo == null ? "" : lo;
    if (hi != null && (hi.isEmpty() || a.compareTo(hi) >= 0)) {
      return new Rank(null, true);
    }
    if (a.endsWith("0") || (hi != null && hi.endsWith("0"))) {
      return new Rank(null, true);
    }
    String value = midpoint(a, hi);
    return new Rank(value, value.length() > MAX_LENGTH);
  }

  /** n strictly increasing short ranks, used to re-rank a scope. */
  public static List<String> spread(int n) {
    List<String> out = new ArrayList<>(n);
    if (n == 0) {
      return out;
    }
    int width = 1;
    long capacity = 62;
    while (capacity < (long) (n + 2) * 4) {
      width++;
      capacity *= 62;
    }
    long step = capacity / (n + 1);
    for (int i = 1; i <= n; i++) {
      long value = step * i;
      if (value % 62 == 0) {
        value += 1;
      }
      out.add(encode(value, width));
    }
    return out;
  }

  private static String encode(long value, int width) {
    char[] chars = new char[width];
    for (int i = width - 1; i >= 0; i--) {
      chars[i] = DIGITS.charAt((int) (value % 62));
      value /= 62;
    }
    return new String(chars);
  }

  private static char at(String s, int i) {
    return i < s.length() ? s.charAt(i) : DIGITS.charAt(0);
  }

  private static String midpoint(String a, String b) {
    if (b != null) {
      int n = 0;
      while (n < b.length() && at(a, n) == b.charAt(n)) {
        n++;
      }
      if (n > 0) {
        return b.substring(0, n) + midpoint(a.length() > n ? a.substring(n) : "", b.substring(n));
      }
    }
    int digitA = a.isEmpty() ? 0 : DIGITS.indexOf(a.charAt(0));
    int digitB = b != null ? DIGITS.indexOf(b.charAt(0)) : DIGITS.length();
    if (digitB - digitA > 1) {
      int mid = (int) Math.round(0.5 * (digitA + digitB));
      return String.valueOf(DIGITS.charAt(mid));
    }
    if (b != null && b.length() > 1) {
      return b.substring(0, 1);
    }
    return DIGITS.charAt(digitA) + midpoint(a.isEmpty() ? "" : a.substring(1), null);
  }
}
