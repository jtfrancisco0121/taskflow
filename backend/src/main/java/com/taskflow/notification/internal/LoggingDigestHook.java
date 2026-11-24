package com.taskflow.notification.internal;

import com.taskflow.notification.DigestHook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** Does nothing but log: actual email sending is out of scope (CAP-13). */
@Component
class LoggingDigestHook implements DigestHook {

  private static final Logger log = LoggerFactory.getLogger(LoggingDigestHook.class);

  @Override
  public void accept(Entry entry) {
    log.debug(
        "digest hook: notification {} ({}) for {}",
        entry.notificationId(),
        entry.kind(),
        entry.recipientId());
  }
}
