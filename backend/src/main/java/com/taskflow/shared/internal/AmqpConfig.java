package com.taskflow.shared.internal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.EventQueues;
import com.taskflow.shared.TransientFailures;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.config.RetryInterceptorBuilder;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.retry.RejectAndDontRequeueRecoverer;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.boot.autoconfigure.amqp.SimpleRabbitListenerContainerFactoryConfigurer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.retry.RetryContext;
import org.springframework.retry.policy.SimpleRetryPolicy;

/**
 * RabbitMQ topology and listener behaviour shared by every consumer (AD-2, AD-4): the event
 * exchange, the dead-letter exchange, and a listener factory that retries transient failures 3
 * times (1 s, then 5 s) and then rejects without requeue, which sends the message to the DLQ.
 */
@Configuration
class AmqpConfig {

  @Bean
  TopicExchange taskflowEventsExchange() {
    return new TopicExchange(EventQueues.EXCHANGE, true, false);
  }

  @Bean
  DirectExchange taskflowDeadLetterExchange() {
    return new DirectExchange(EventQueues.DEAD_LETTER_EXCHANGE, true, false);
  }

  @Bean
  MessageConverter amqpMessageConverter(ObjectMapper mapper) {
    return new Jackson2JsonMessageConverter(mapper);
  }

  @Bean(name = EventQueues.LISTENER_FACTORY)
  SimpleRabbitListenerContainerFactory taskflowListenerFactory(
      SimpleRabbitListenerContainerFactoryConfigurer configurer, ConnectionFactory connections) {
    SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
    configurer.configure(factory, connections);
    factory.setDefaultRequeueRejected(false);
    factory.setAdviceChain(
        RetryInterceptorBuilder.stateless()
            .retryPolicy(new TransientOnlyRetryPolicy(3))
            .backOffOptions(1000, 5.0, 25000)
            .recoverer(new RejectAndDontRequeueRecoverer())
            .build());
    return factory;
  }

  /** Retries only what {@link TransientFailures} accepts, at most {@code attempts} times. */
  static final class TransientOnlyRetryPolicy extends SimpleRetryPolicy {

    TransientOnlyRetryPolicy(int attempts) {
      super(attempts);
    }

    @Override
    public boolean canRetry(RetryContext context) {
      Throwable last = context.getLastThrowable();
      if (last != null && !TransientFailures.isTransient(last)) {
        return false;
      }
      return super.canRetry(context);
    }
  }
}
