package com.example;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class EmployeeService {

    @Value("${employee.default-department}")
    private String defaultDepartment;

    public String describe(Employee e) {
        log.info("describing {}", e.getFirstName());
        return e.getFirstName() + " active=" + e.isActive();
    }
}
