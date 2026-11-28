package com.taskflow.shared.internal;

import com.taskflow.shared.LockContention;
import com.taskflow.shared.TaskflowException;
import jakarta.validation.ConstraintViolationException;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/** Renders every error as application/problem+json (RFC 9457) with a dotted {@code code}. */
@RestControllerAdvice
class ProblemDetailsHandler extends ResponseEntityExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(ProblemDetailsHandler.class);

  @ExceptionHandler(TaskflowException.class)
  ResponseEntity<ProblemDetail> domain(TaskflowException e) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(e.status(), e.getMessage());
    problem.setTitle(e.status().getReasonPhrase());
    problem.setProperty("code", e.code());
    e.extra().forEach(problem::setProperty);
    ResponseEntity.BodyBuilder builder = ResponseEntity.status(e.status());
    e.headers().forEach(builder::header);
    return builder.body(problem);
  }

  @ExceptionHandler(AccessDeniedException.class)
  ResponseEntity<ProblemDetail> denied(AccessDeniedException e) {
    return domain(TaskflowException.forbidden("auth.forbidden", "Access denied"));
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<ProblemDetail> integrity(DataIntegrityViolationException e) {
    log.warn("integrity violation: {}", e.getMostSpecificCause().getMessage());
    return domain(
        TaskflowException.conflict("request.conflict", "The request conflicts with current data"));
  }

  /**
   * Lock contention ({@link LockContention}) is 503 with Retry-After rather than 500 (ClickUp
   * 14yq6g334r6); any other uncategorized error is rethrown unchanged.
   */
  @ExceptionHandler({PessimisticLockingFailureException.class, UncategorizedSQLException.class})
  ResponseEntity<ProblemDetail> contention(DataAccessException e) {
    if (!LockContention.isContention(e)) {
      throw e;
    }
    log.warn("lock contention: {}", e.getMostSpecificCause().getMessage());
    return domain(
        new TaskflowException(
                HttpStatus.SERVICE_UNAVAILABLE, "request.busy", "The server is busy; retry shortly")
            .header(HttpHeaders.RETRY_AFTER, "1"));
  }

  @ExceptionHandler(ConstraintViolationException.class)
  ResponseEntity<ProblemDetail> constraint(ConstraintViolationException e) {
    List<Map<String, String>> errors =
        e.getConstraintViolations().stream()
            .map(v ->
                Map.of(
                    "field",
                    v.getPropertyPath().toString(),
                    "message",
                    String.valueOf(v.getMessage())))
            .toList();
    return domain(
        TaskflowException.badRequest("request.invalid", "Validation failed")
            .with("errors", errors));
  }

  @Override
  protected ResponseEntity<Object> handleMethodArgumentNotValid(
      MethodArgumentNotValidException ex,
      HttpHeaders headers,
      HttpStatusCode status,
      WebRequest request) {
    List<Map<String, String>> errors =
        ex.getBindingResult().getFieldErrors().stream()
            .map(f ->
                Map.of(
                    "field",
                    f.getField(),
                    "message",
                    f.getDefaultMessage() == null ? "invalid" : f.getDefaultMessage()))
            .toList();
    ProblemDetail problem =
        ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
    problem.setTitle(HttpStatus.BAD_REQUEST.getReasonPhrase());
    problem.setProperty("code", "request.invalid");
    problem.setProperty("errors", errors);
    return ResponseEntity.badRequest().body(problem);
  }

  @Override
  protected ResponseEntity<Object> handleExceptionInternal(
      Exception ex,
      Object body,
      HttpHeaders headers,
      HttpStatusCode statusCode,
      WebRequest request) {
    ResponseEntity<Object> response =
        super.handleExceptionInternal(ex, body, headers, statusCode, request);
    if (response != null
        && response.getBody() instanceof ProblemDetail problem
        && (problem.getProperties() == null || !problem.getProperties().containsKey("code"))) {
      problem.setProperty("code", "request." + statusCode.value());
    }
    return response;
  }
}
