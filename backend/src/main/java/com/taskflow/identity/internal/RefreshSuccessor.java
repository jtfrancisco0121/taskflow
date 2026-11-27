package com.taskflow.identity.internal;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * Derives a refresh token's successor from the token itself (decision 010), so a replay of the
 * token just rotated can be answered with the same successor without storing any raw token. The key
 * comes from the JWT secret through HKDF-SHA256 (RFC 5869) with its own label, so it is never the
 * access token signing key.
 */
@Component
class RefreshSuccessor {

  static final String LABEL = "taskflow-refresh-successor-v1";
  private static final String HMAC = "HmacSHA256";

  private final byte[] key;

  RefreshSuccessor(JwtProperties properties) {
    this.key =
        hkdf(
            new byte[0],
            properties.secret().getBytes(StandardCharsets.UTF_8),
            LABEL.getBytes(StandardCharsets.UTF_8),
            32);
  }

  /** The successor of {@code rawToken}: base64url(HMAC-SHA256(key, rawToken)), 256 bits. */
  String of(String rawToken) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(hmac(key, rawToken.getBytes(StandardCharsets.UTF_8)));
  }

  /** Constant-time comparison of two token hashes (hex strings). */
  static boolean sameHash(String expected, String actual) {
    if (expected == null || actual == null) {
      return false;
    }
    return MessageDigest.isEqual(
        expected.getBytes(StandardCharsets.US_ASCII), actual.getBytes(StandardCharsets.US_ASCII));
  }

  /** Test seam: a copy of the derived key. */
  byte[] keyForTests() {
    return key.clone();
  }

  /** HKDF-SHA256 (RFC 5869): extract with {@code salt} (empty means HashLen zeros), then expand. */
  static byte[] hkdf(byte[] salt, byte[] ikm, byte[] info, int length) {
    if (length <= 0 || length > 255 * 32) {
      throw new IllegalArgumentException("HKDF length out of range");
    }
    byte[] prk = hmac(salt.length == 0 ? new byte[32] : salt, ikm);
    byte[] okm = new byte[length];
    byte[] previous = new byte[0];
    int offset = 0;
    for (int counter = 1; offset < length; counter++) {
      byte[] input = new byte[previous.length + info.length + 1];
      System.arraycopy(previous, 0, input, 0, previous.length);
      System.arraycopy(info, 0, input, previous.length, info.length);
      input[input.length - 1] = (byte) counter;
      previous = hmac(prk, input);
      int n = Math.min(previous.length, length - offset);
      System.arraycopy(previous, 0, okm, offset, n);
      offset += n;
    }
    Arrays.fill(prk, (byte) 0);
    return okm;
  }

  private static byte[] hmac(byte[] key, byte[] data) {
    try {
      Mac mac = Mac.getInstance(HMAC);
      mac.init(new SecretKeySpec(key, HMAC));
      return mac.doFinal(data);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }
}
