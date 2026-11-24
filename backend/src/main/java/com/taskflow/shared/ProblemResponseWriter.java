package com.taskflow.shared;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

/** Writes the same problem+json shape as the MVC handler, for filters and security handlers. */
@Component
public class ProblemResponseWriter {

  private final ObjectMapper mapper;

  ProblemResponseWriter(ObjectMapper mapper) {
    this.mapper = mapper;
  }

  public void write(
      HttpServletResponse response,
      HttpStatus status,
      String code,
      String detail,
      Map<String, Object> extra)
      throws IOException {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "about:blank");
    body.put("title", status.getReasonPhrase());
    body.put("status", status.value());
    body.put("detail", detail);
    body.put("code", code);
    if (extra != null) {
      body.putAll(extra);
    }
    response.setStatus(status.value());
    response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
    response.setCharacterEncoding("UTF-8");
    response.getOutputStream().write(mapper.writeValueAsBytes(body));
    response.flushBuffer();
  }

  public void write(HttpServletResponse response, HttpStatus status, String code, String detail)
      throws IOException {
    write(response, status, code, detail, null);
  }
}
