package com.taskflow.identity.internal;

import java.time.Duration;
import java.util.Collection;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Hashes of keys whose Postgres lookup found no usable key, kept for 60 s so a retry loop with a
 * revoked or expired key does not reach Postgres. It only ever adds denials: every reason a lookup
 * fails is final except a disabled account, which {@code enable} clears. Redis errors are only
 * logged, because this is an optimisation and never a reason to fail a request.
 */
@Component
class ApiKeyNegativeCache {

  private static final Logger log = LoggerFactory.getLogger(ApiKeyNegativeCache.class);
  static final Duration TTL = Duration.ofSeconds(60);
  static final String PREFIX = "apikey-neg:";

  private final StringRedisTemplate redis;

  ApiKeyNegativeCache(StringRedisTemplate redis) {
    this.redis = redis;
  }

  boolean contains(String keyHash) {
    try {
      return Boolean.TRUE.equals(redis.hasKey(PREFIX + keyHash));
    } catch (RuntimeException e) {
      log.warn("api key negative cache read failed: {}", e.toString());
      return false;
    }
  }

  void remember(String keyHash) {
    try {
      redis.opsForValue().set(PREFIX + keyHash, "1", TTL);
    } catch (RuntimeException e) {
      log.warn("api key negative cache write failed: {}", e.toString());
    }
  }

  /** Clears entries once the surrounding transaction commits, or at once without one. */
  void forgetAfterCommit(Collection<String> keyHashes) {
    if (keyHashes.isEmpty()) {
      return;
    }
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              forget(keyHashes);
            }
          });
    } else {
      forget(keyHashes);
    }
  }

  private void forget(Collection<String> keyHashes) {
    try {
      redis.delete(keyHashes.stream().map(h -> PREFIX + h).toList());
    } catch (RuntimeException e) {
      log.warn("api key negative cache clear failed: {}", e.toString());
    }
  }
}
