package com.taskflow.shared.internal;

import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/** Renders every Spring MVC error as application/problem+json (RFC 9457). */
@RestControllerAdvice
class ProblemDetailsHandler extends ResponseEntityExceptionHandler {}
