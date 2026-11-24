package com.taskflow.identity;

import java.util.UUID;

public record UserInfo(UUID id, String email, String displayName) {}
