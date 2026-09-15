package com.example.loan;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/loans")
public class LoanController {

    @PostMapping
    public void create() {
    }
}
