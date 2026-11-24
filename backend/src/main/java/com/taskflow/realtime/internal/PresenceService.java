package com.taskflow.realtime.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Who is looking at a task (RT-2, AD-16). A Redis sorted set {@code presence:task:<taskId>} holds
 * the user ids scored by their expiry time, so every instance sees the same viewers. Every change
 * publishes the full viewer list on {@code taskflow:presence}; each instance forwards it to {@code
 * /topic/task/<id>/presence}. Presence never goes through the outbox.
 */
@Service
class PresenceService {

  static final String CHANNEL = "taskflow:presence";
  static final String KEY_PREFIX = "presence:task:";
  private static final Logger log = LoggerFactory.getLogger(PresenceService.class);

  private final StringRedisTemplate redis;
  private final ObjectMapper mapper;
  private final RealtimeProperties properties;

  PresenceService(StringRedisTemplate redis, ObjectMapper mapper, RealtimeProperties properties) {
    this.redis = redis;
    this.mapper = mapper;
    this.properties = properties;
  }

  /** The user is viewing the task; sent on open and every 20 s. */
  void heartbeat(UUID taskId, UUID userId) {
    String key = KEY_PREFIX + taskId;
    long now = System.currentTimeMillis();
    redis.opsForZSet().removeRangeByScore(key, Double.NEGATIVE_INFINITY, now);
    redis.opsForZSet().add(key, userId.toString(), now + properties.presenceTtlMs());
    redis.expire(key, java.time.Duration.ofMillis(properties.presenceTtlMs() * 2));
    publish(taskId);
  }

  void leave(UUID taskId, UUID userId) {
    Long removed = redis.opsForZSet().remove(KEY_PREFIX + taskId, userId.toString());
    if (removed != null && removed > 0) {
      publish(taskId);
    }
  }

  /** Viewers whose heartbeat has not expired. */
  List<String> viewers(UUID taskId) {
    String key = KEY_PREFIX + taskId;
    Set<String> members =
        redis
            .opsForZSet()
            .rangeByScore(key, System.currentTimeMillis() + 1, Double.POSITIVE_INFINITY);
    return members == null ? List.of() : new ArrayList<>(members);
  }

  /** Drops expired viewers of every task and tells the others. */
  @Scheduled(fixedDelayString = "${taskflow.realtime.presence-sweep-ms:10000}")
  void sweep() {
    try {
      long now = System.currentTimeMillis();
      List<String> keys = new ArrayList<>();
      try (Cursor<String> cursor =
          redis.scan(ScanOptions.scanOptions().match(KEY_PREFIX + "*").count(200).build())) {
        cursor.forEachRemaining(keys::add);
      }
      for (String key : keys) {
        Long removed = redis.opsForZSet().removeRangeByScore(key, Double.NEGATIVE_INFINITY, now);
        if (removed != null && removed > 0) {
          publish(UUID.fromString(key.substring(KEY_PREFIX.length())));
        }
      }
    } catch (RuntimeException e) {
      log.warn("presence sweep failed: {}", e.toString());
    }
  }

  private void publish(UUID taskId) {
    try {
      redis.convertAndSend(
          CHANNEL,
          mapper.writeValueAsString(
              Map.of("taskId", taskId.toString(), "viewers", viewers(taskId))));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }
}
