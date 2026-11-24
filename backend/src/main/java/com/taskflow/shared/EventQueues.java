package com.taskflow.shared;

import java.util.ArrayList;
import java.util.List;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.Declarable;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;

/**
 * Lets a module declare its own durable queue on the {@code taskflow.events} exchange, with a
 * dead-letter queue {@code <name>.dlq} (AD-2). The owning module exposes the result as a bean.
 */
public final class EventQueues {

  public static final String EXCHANGE = "taskflow.events";
  public static final String DEAD_LETTER_EXCHANGE = "taskflow.events.dlx";

  /** Name of the listener container factory with retry and dead-lettering (AD-4). */
  public static final String LISTENER_FACTORY = "taskflowListenerFactory";

  private EventQueues() {}

  public static Declarables declare(String queueName, String... routingKeys) {
    List<Declarable> all = new ArrayList<>();
    Queue queue =
        QueueBuilder.durable(queueName)
            .withArgument("x-dead-letter-exchange", DEAD_LETTER_EXCHANGE)
            .withArgument("x-dead-letter-routing-key", queueName)
            .build();
    all.add(queue);
    for (String key : routingKeys) {
      all.add(new Binding(queueName, Binding.DestinationType.QUEUE, EXCHANGE, key, null));
    }
    Queue dlq = QueueBuilder.durable(queueName + ".dlq").build();
    all.add(dlq);
    all.add(
        new Binding(
            dlq.getName(), Binding.DestinationType.QUEUE, DEAD_LETTER_EXCHANGE, queueName, null));
    return new Declarables(all);
  }
}
