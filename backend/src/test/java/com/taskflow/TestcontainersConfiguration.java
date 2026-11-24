package com.taskflow;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;

@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

  /** A fixed test secret: tests mint their own tokens, for example an expired one. */
  public static final String JWT_SECRET = "test-secret-test-secret-test-secret-0123456789";

  /** Keep this tag equal to the postgres image in deploy/compose.yaml. */
  @Bean
  @ServiceConnection
  PostgreSQLContainer<?> postgresContainer() {
    return new PostgreSQLContainer<>("postgres:18");
  }

  /** Keep this tag equal to the redis image in deploy/compose.yaml. */
  @Bean
  @ServiceConnection(name = "redis")
  GenericContainer<?> redisContainer() {
    return new GenericContainer<>("redis:8.12").withExposedPorts(6379);
  }

  /** Keep this tag equal to the rabbitmq image in deploy/compose.yaml. */
  @Bean
  @ServiceConnection
  RabbitMQContainer rabbitContainer() {
    return new RabbitMQContainer("rabbitmq:4.3-management");
  }

  /** Keep this tag equal to the mailpit image in deploy/compose.yaml. */
  @Bean
  GenericContainer<?> mailpitContainer() {
    return new GenericContainer<>("axllent/mailpit:v1.34").withExposedPorts(1025, 8025);
  }

  @Bean
  DynamicPropertyRegistrar testProperties(GenericContainer<?> mailpitContainer) {
    return registry -> {
      registry.add("spring.mail.host", mailpitContainer::getHost);
      registry.add("spring.mail.port", () -> mailpitContainer.getMappedPort(1025));
      registry.add(
          "taskflow.test.mailpit-api",
          () ->
              "http://" + mailpitContainer.getHost() + ":" + mailpitContainer.getMappedPort(8025));
      registry.add("taskflow.jwt.secret", () -> JWT_SECRET);
      registry.add("taskflow.purge.enabled", () -> "false");
    };
  }
}
