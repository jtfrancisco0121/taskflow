package com.taskflow.field.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.TextNode;
import com.taskflow.field.FieldInfo;
import com.taskflow.field.OptionInfo;
import com.taskflow.shared.TaskflowException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * One strategy per field type (AD-1, field-types.md): validate and normalise a client value,
 * project a stored value for reads, and print a value for activity text. The single definition of
 * what a value of each type looks like; task and view never parse a custom value themselves.
 */
final class FieldTypes {

  static final int MAX_TEXT = 2000;
  static final int MAX_LONG_TEXT = 10000;
  static final int MAX_URL = 2000;
  static final int MAX_EMAIL = 254;
  static final int MAX_LABELS = 50;
  static final int MAX_PEOPLE = 50;
  static final double MAX_ABS_NUMBER = 1e15;
  private static final DateTimeFormatter DAY =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'00:00:00'Z'");

  private FieldTypes() {}

  /**
   * The value to store, or {@code null} when the request clears the field. Throws 400
   * field.invalid_value naming the field.
   */
  /** Which of these users are current members of the Workspace (the rule assignees follow). */
  @FunctionalInterface
  interface Members {
    Set<UUID> among(UUID workspaceId, Collection<UUID> userIds);
  }

  static JsonNode normalize(FieldInfo f, JsonNode raw, Members members) {
    if (raw == null || raw.isNull() || raw.isMissingNode()) {
      return null;
    }
    return switch (f.type()) {
      case TEXT -> text(f, raw, MAX_TEXT);
      case LONG_TEXT -> text(f, raw, MAX_LONG_TEXT);
      case NUMBER -> number(f, raw);
      case DATE -> date(f, raw);
      case DROPDOWN -> dropdown(f, raw);
      case LABELS -> labels(f, raw);
      case CHECKBOX -> checkbox(f, raw);
      case URL -> url(f, raw);
      case EMAIL -> email(f, raw);
      case RATING -> rating(f, raw);
      case PROGRESS -> progress(f, raw);
      case PEOPLE -> people(f, raw, members);
    };
  }

  /** A stored value as reads show it, or {@code null} when it must be omitted. */
  static JsonNode project(FieldInfo f, JsonNode stored) {
    if (stored == null || stored.isNull()) {
      return null;
    }
    return switch (f.type()) {
      case TEXT, LONG_TEXT, DATE, URL, EMAIL -> stored.isTextual() ? stored : null;
      case NUMBER, RATING, PROGRESS -> stored.isNumber() ? stored : null;
      case CHECKBOX -> stored.isBoolean() && stored.asBoolean() ? stored : null;
      case DROPDOWN ->
          stored.isTextual() && optionById(f, stored.asText()).isPresent() ? stored : null;
      case LABELS -> {
        if (!stored.isArray()) {
          yield null;
        }
        ArrayNode live = JsonNodeFactory.instance.arrayNode();
        stored.forEach(n -> {
          if (n.isTextual() && optionById(f, n.asText()).isPresent()) {
            live.add(n);
          }
        });
        yield live.isEmpty() ? null : live;
      }
      case PEOPLE -> stored.isArray() && !stored.isEmpty() ? stored : null;
    };
  }

  /** A short text of a stored value for "set X to Y" activity lines; never null. */
  static String display(FieldInfo f, JsonNode stored) {
    JsonNode v = project(f, stored);
    if (v == null) {
      return "";
    }
    return switch (f.type()) {
      case DROPDOWN -> optionById(f, v.asText()).map(OptionInfo::name).orElse("");
      case LABELS -> {
        StringBuilder out = new StringBuilder();
        v.forEach(n -> {
          String name = optionById(f, n.asText()).map(OptionInfo::name).orElse("");
          if (!out.isEmpty()) {
            out.append(", ");
          }
          out.append(name);
        });
        yield out.toString();
      }
      case NUMBER -> v.decimalValue().stripTrailingZeros().toPlainString();
      case DATE -> v.asText().length() >= 10 ? v.asText().substring(0, 10) : v.asText();
      case CHECKBOX -> "checked";
      case RATING -> v.asText() + " of " + f.config().getOrDefault("max", 5);
      case PROGRESS -> v.asText() + "%";
      case PEOPLE -> v.size() + (v.size() == 1 ? " person" : " people");
      default -> v.asText();
    };
  }

  // ---------------------------------------------------------------- types

  private static JsonNode text(FieldInfo f, JsonNode raw, int max) {
    if (!raw.isTextual()) {
      throw invalid(f, "expects text");
    }
    String s = raw.asText().trim();
    if (s.isEmpty()) {
      throw invalid(f, "can't be blank; send null to clear it");
    }
    if (s.length() > max) {
      throw invalid(f, "is at most " + max + " characters");
    }
    return TextNode.valueOf(s);
  }

  private static JsonNode number(FieldInfo f, JsonNode raw) {
    if (!raw.isNumber()) {
      throw invalid(f, "expects a number");
    }
    double d = raw.doubleValue();
    if (!Double.isFinite(d) || Math.abs(d) >= MAX_ABS_NUMBER) {
      throw invalid(f, "must be a number below 1e15");
    }
    return raw;
  }

  private static JsonNode date(FieldInfo f, JsonNode raw) {
    if (!raw.isTextual()) {
      throw invalid(f, "expects a date such as 2026-12-31");
    }
    String s = raw.asText().trim();
    try {
      Instant instant =
          s.length() == 10
              ? LocalDate.parse(s).atStartOfDay().toInstant(ZoneOffset.UTC)
              : Instant.parse(s);
      return TextNode.valueOf(DAY.format(instant.atOffset(ZoneOffset.UTC)));
    } catch (DateTimeParseException e) {
      throw invalid(f, "expects a date such as 2026-12-31");
    }
  }

  private static JsonNode dropdown(FieldInfo f, JsonNode raw) {
    if (!raw.isTextual()) {
      throw invalid(f, "expects one of: " + names(f));
    }
    return TextNode.valueOf(resolve(f, raw.asText()).id().toString());
  }

  private static JsonNode labels(FieldInfo f, JsonNode raw) {
    if (!raw.isArray()) {
      throw invalid(f, "expects a list of: " + names(f));
    }
    if (raw.isEmpty()) {
      return null;
    }
    if (raw.size() > MAX_LABELS) {
      throw invalid(f, "takes at most " + MAX_LABELS + " labels");
    }
    ArrayNode out = JsonNodeFactory.instance.arrayNode();
    Set<UUID> seen = new HashSet<>();
    for (JsonNode n : raw) {
      if (!n.isTextual()) {
        throw invalid(f, "expects a list of: " + names(f));
      }
      OptionInfo option = resolve(f, n.asText());
      if (!seen.add(option.id())) {
        throw invalid(f, "lists " + option.name() + " twice");
      }
      out.add(option.id().toString());
    }
    return out;
  }

  /** 1 to 50 user ids, each a current member of the Workspace; duplicates are folded. */
  private static JsonNode people(FieldInfo f, JsonNode raw, Members members) {
    if (!raw.isArray()) {
      throw invalid(f, "expects a list of user ids");
    }
    if (raw.isEmpty()) {
      return null;
    }
    Set<UUID> ids = new LinkedHashSet<>();
    for (JsonNode n : raw) {
      try {
        ids.add(UUID.fromString(n.asText().trim()));
      } catch (IllegalArgumentException e) {
        throw invalid(f, "expects a list of user ids");
      }
    }
    if (ids.size() > MAX_PEOPLE) {
      throw invalid(f, "takes at most " + MAX_PEOPLE + " people");
    }
    Set<UUID> current = members.among(f.workspaceId(), ids);
    for (UUID id : ids) {
      if (!current.contains(id)) {
        throw invalid(f, "has " + id + ", who is not a member of this Workspace");
      }
    }
    ArrayNode out = JsonNodeFactory.instance.arrayNode();
    ids.forEach(id -> out.add(id.toString()));
    return out;
  }

  private static JsonNode checkbox(FieldInfo f, JsonNode raw) {
    if (!raw.isBoolean()) {
      throw invalid(f, "expects true or false");
    }
    return raw.asBoolean() ? BooleanNode.TRUE : null;
  }

  private static JsonNode url(FieldInfo f, JsonNode raw) {
    if (!raw.isTextual()) {
      throw invalid(f, "expects a web address");
    }
    String s = raw.asText().trim();
    if (s.isEmpty() || s.length() > MAX_URL) {
      throw invalid(f, "expects a web address of at most " + MAX_URL + " characters");
    }
    try {
      URI uri = new URI(s);
      String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
      if (!(scheme.equals("http") || scheme.equals("https"))
          || uri.getHost() == null
          || uri.getHost().isEmpty()) {
        throw invalid(f, "expects an absolute http or https address");
      }
    } catch (URISyntaxException e) {
      throw invalid(f, "expects an absolute http or https address");
    }
    return TextNode.valueOf(s);
  }

  private static JsonNode email(FieldInfo f, JsonNode raw) {
    if (!raw.isTextual()) {
      throw invalid(f, "expects an email address");
    }
    String s = raw.asText().trim();
    int at = s.indexOf('@');
    if (s.isEmpty()
        || s.length() > MAX_EMAIL
        || at <= 0
        || at != s.lastIndexOf('@')
        || at == s.length() - 1
        || s.chars().anyMatch(Character::isWhitespace)) {
      throw invalid(f, "expects an email address");
    }
    return TextNode.valueOf(
        s.substring(0, at) + "@" + s.substring(at + 1).toLowerCase(Locale.ROOT));
  }

  private static JsonNode rating(FieldInfo f, JsonNode raw) {
    int max = ((Number) f.config().getOrDefault("max", 5)).intValue();
    int v = whole(f, raw, "a whole number from 1 to " + max);
    if (v == 0) {
      return null;
    }
    if (v < 1 || v > max) {
      throw invalid(f, "expects a whole number from 1 to " + max + " (0 clears it)");
    }
    return JsonNodeFactory.instance.numberNode(v);
  }

  private static JsonNode progress(FieldInfo f, JsonNode raw) {
    int v = whole(f, raw, "a whole number from 0 to 100");
    if (v < 0 || v > 100) {
      throw invalid(f, "expects a whole number from 0 to 100");
    }
    return JsonNodeFactory.instance.numberNode(v);
  }

  private static int whole(FieldInfo f, JsonNode raw, String expects) {
    if (!raw.isNumber()
        || raw.decimalValue().remainder(BigDecimal.ONE).signum() != 0
        || raw.decimalValue().abs().compareTo(BigDecimal.valueOf(1_000_000)) > 0) {
      throw invalid(f, "expects " + expects);
    }
    return raw.intValue();
  }

  // ---------------------------------------------------------------- options

  private static OptionInfo resolve(FieldInfo f, String idOrName) {
    String key = idOrName.trim();
    Optional<OptionInfo> byId = optionById(f, key);
    if (byId.isPresent()) {
      return byId.get();
    }
    String lower = key.toLowerCase(Locale.ROOT);
    return f.options().stream()
        .filter(o -> o.name().toLowerCase(Locale.ROOT).equals(lower))
        .findFirst()
        .orElseThrow(() -> invalid(f, "has no option '" + key + "'. Pick one of: " + names(f)));
  }

  private static Optional<OptionInfo> optionById(FieldInfo f, String id) {
    return f.options().stream().filter(o -> o.id().toString().equalsIgnoreCase(id)).findFirst();
  }

  private static String names(FieldInfo f) {
    List<String> names = f.options().stream().map(OptionInfo::name).toList();
    return names.isEmpty()
        ? "(no options defined)"
        : names.stream().collect(Collectors.joining(", "));
  }

  private static TaskflowException invalid(FieldInfo f, String reason) {
    return TaskflowException.badRequest("field.invalid_value", f.name() + " " + reason)
        .with("fieldId", f.id().toString());
  }
}
