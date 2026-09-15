package com.example.loan;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/loans")
public class LoanController {

    private final LoanService loanService;

    public LoanController(LoanService loanService) {
        this.loanService = loanService;
    }

    @PostMapping("/{id}/disburse")
    public void disburse(@PathVariable Long id) {
        loanService.disburse(id);
    }

    @GetMapping("/{id}")
    public void getLoan(@PathVariable Long id) {
        loanService.find(id);
    }
}
