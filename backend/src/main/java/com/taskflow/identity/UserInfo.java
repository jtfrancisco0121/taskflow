package com.taskflow.identity;

import java.util.UUID;

/** {@code email} is null for a service account (an agent has no email). */
public record UserInfo(UUID id, String email, String displayName) {}
