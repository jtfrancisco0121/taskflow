package com.taskflow.workspace.internal;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** Sends the invite mail only after the invite committed (AD-8, AD-21). */
@Component
class InviteMailer {

  private static final Logger log = LoggerFactory.getLogger(InviteMailer.class);

  private final JavaMailSender mail;
  private final String appUrl;
  private final String from;

  InviteMailer(
      JavaMailSender mail,
      @Value("${taskflow.app-url}") String appUrl,
      @Value("${taskflow.mail.from:no-reply@taskflow.local}") String from) {
    this.mail = mail;
    this.appUrl = appUrl.endsWith("/") ? appUrl.substring(0, appUrl.length() - 1) : appUrl;
    this.from = from;
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  void send(InviteService.InviteCreated invite) {
    SimpleMailMessage message = new SimpleMailMessage();
    message.setFrom(from);
    message.setTo(invite.email());
    message.setSubject("You are invited to " + invite.workspaceName() + " on Taskflow");
    message.setText(
        "You have been invited to join "
            + invite.workspaceName()
            + " on Taskflow.\n\nAccept the invite: "
            + appUrl
            + "/invite/"
            + invite.token()
            + "\n\nThe link is valid until "
            + invite.expiresAt()
            + ".");
    try {
      mail.send(message);
    } catch (RuntimeException e) {
      // The invite is committed; the owner can revoke and resend. Never log the token.
      log.warn("invite mail to {} could not be sent: {}", invite.email(), e.getMessage());
    }
  }
}
