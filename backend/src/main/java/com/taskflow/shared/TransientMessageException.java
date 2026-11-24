package com.taskflow.shared;

/** Thrown by a message consumer to ask for a retry of the whole message (AD-4). */
public class TransientMessageException extends RuntimeException {

  public TransientMessageException(String message) {
    super(message);
  }

  public TransientMessageException(String message, Throwable cause) {
    super(message, cause);
  }
}
