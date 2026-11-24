package com.taskflow.view.internal;

import com.taskflow.IntegrationTest;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Shared fixtures for the view integration tests. */
abstract class ViewTestBase extends IntegrationTest {

  protected Map<String, Object> config() {
    return Map.of("v", 1);
  }

  protected Resp createView(
      TestUser user, UUID locationId, String name, String type, String visibility, Object config) {
    Map<String, Object> body = new HashMap<>();
    body.put("locationId", locationId);
    body.put("name", name);
    body.put("type", type);
    body.put("visibility", visibility);
    body.put("config", config);
    return post("/api/v1/views", user.token(), body);
  }

  protected Resp createWorkspaceView(
      TestUser user, UUID workspaceId, String name, String type, String visibility) {
    Map<String, Object> body = new HashMap<>();
    body.put("workspaceId", workspaceId);
    body.put("name", name);
    body.put("type", type);
    body.put("visibility", visibility);
    body.put("config", config());
    return post("/api/v1/views", user.token(), body);
  }

  protected List<String> names(Resp r) {
    List<String> out = new java.util.ArrayList<>();
    r.at("/items").forEach(n -> out.add(n.get("name").asText()));
    return out;
  }
}
