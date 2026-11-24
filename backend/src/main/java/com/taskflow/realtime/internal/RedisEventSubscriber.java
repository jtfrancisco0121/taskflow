package com.taskflow.realtime.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.messaging.simp.SimpMessagingTemplate;

/**
 * Forwards Redis pub/sub to the STOMP clients connected to this instance (AD-11, AD-14, AD-15).
 * Browsers get ids, type and version only, never task content.
 */
@Configuration
class RedisEventSubscriber {

  private static final Logger log = LoggerFactory.getLogger(RedisEventSubscriber.class);

  @Bean
  RedisMessageListenerContainer realtimeRedisListeners(
      RedisConnectionFactory connectionFactory,
      EventRouter router,
      SimpMessagingTemplate broker,
      ObjectMapper mapper) {
    RedisMessageListenerContainer container = new RedisMessageListenerContainer();
    container.setConnectionFactory(connectionFactory);
    container.addMessageListener(
        (message, pattern) -> {
          try {
            forwardEvent(mapper.readTree(body(message.getBody())), router, broker);
          } catch (Exception e) {
            log.warn("could not forward event: {}", e.toString());
          }
        },
        new ChannelTopic("taskflow:events"));
    container.addMessageListener(
        (message, pattern) -> {
          try {
            JsonNode n = mapper.readTree(body(message.getBody()));
            String taskId = n.get("taskId").asText();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("taskId", taskId);
            out.put("viewers", mapper.convertValue(n.get("viewers"), List.class));
            broker.convertAndSend("/topic/task/" + taskId + "/presence", out);
          } catch (Exception e) {
            log.warn("could not forward presence: {}", e.toString());
          }
        },
        new ChannelTopic(PresenceService.CHANNEL));
    return container;
  }

  private static String body(byte[] raw) {
    return new String(raw, StandardCharsets.UTF_8);
  }

  static void forwardEvent(JsonNode event, EventRouter router, SimpMessagingTemplate broker) {
    UUID workspaceId = UUID.fromString(event.get("workspaceId").asText());
    String entity = event.get("entity").asText();
    UUID entityId = UUID.fromString(event.get("entityId").asText());
    String type = event.get("type").asText();
    JsonNode payload = event.get("payload");
    List<String> topics = router.topics(workspaceId, entity, entityId, type, payload);
    if (topics.isEmpty()) {
      return;
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("type", type);
    out.put("entity", entity);
    out.put("entityId", entityId.toString());
    out.put("version", payload.hasNonNull("version") ? payload.get("version").asLong() : null);
    out.put("listId", payload.hasNonNull("listId") ? payload.get("listId").asText() : null);
    out.put("clientId", payload.hasNonNull("clientId") ? payload.get("clientId").asText() : null);
    out.put("occurredAt", event.get("createdAt").asText());
    for (String topic : topics) {
      broker.convertAndSend(topic, out);
    }
  }
}
