package com.taskflow.notification.internal;

import com.taskflow.notification.DigestHook;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * The one shared setup for integration tests of the workers (listeners, notifications, automations,
 * the due-date sweep) on {@code com.taskflow.IntegrationTest} (ClickUp 14yq6g334t6): every class
 * that uses it shares one Spring context and one set of containers, instead of a context per
 * property or spy variant. Use it as is; a class-specific property or spy field starts a new
 * context (ItContextBudgetTest counts them).
 *
 * <ul>
 *   <li>Workers and the AMQP relay on.
 *   <li>The due-date sweep never runs on its own (DueDateSweepIT calls it), so it cannot race with
 *       other tests' tasks.
 *   <li>Spies on {@link NotificationProcessor} and {@link DigestHook}: they call the real beans and
 *       are reset after each test; a test that stubs or verifies them gets them by
 *       {@code @Autowired}.
 * </ul>
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
@TestPropertySource(
    properties = {
      "taskflow.workers.enabled=true",
      "taskflow.outbox.amqp.enabled=true",
      "taskflow.due-sweep.interval-ms=3600000",
      "taskflow.due-sweep.initial-delay-ms=3600000"
    })
@MockitoSpyBean(types = {NotificationProcessor.class, DigestHook.class})
public @interface WorkersIntegrationTest {}
