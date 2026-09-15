package com.example;

import lombok.Data;
import lombok.Builder;

@Data
@Builder
public class Employee {
    private final Long id;
    private String firstName;
    private boolean active;
}
