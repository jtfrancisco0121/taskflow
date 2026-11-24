package com.taskflow.shared;

import java.security.SecureRandom;
import java.util.UUID;

/** UUIDv7 generator: 48-bit millisecond timestamp, then random bits (AD-14). */
public final class Ids {

  private static final SecureRandom RANDOM = new SecureRandom();

  private Ids() {}

  public static UUID newId() {
    long millis = System.currentTimeMillis();
    long randA = RANDOM.nextLong() & 0x0FFFL;
    long msb = (millis << 16) | 0x7000L | randA;
    long lsb = (RANDOM.nextLong() & 0x3FFFFFFFFFFFFFFFL) | 0x8000000000000000L;
    return new UUID(msb, lsb);
  }

  /** The id without hyphens, used as an ltree label. */
  public static String label(UUID id) {
    return id.toString().replace("-", "");
  }
}
