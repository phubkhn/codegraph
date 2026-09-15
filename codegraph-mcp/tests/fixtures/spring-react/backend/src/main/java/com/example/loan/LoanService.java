package com.example.loan;

import org.springframework.stereotype.Service;

@Service
public class LoanService {
    private final LoanRepository loanRepository;

    public LoanService(LoanRepository loanRepository) {
        this.loanRepository = loanRepository;
    }

    public void disburse(Long id) {
        loanRepository.save(id);
    }

    public void find(Long id) {
        loanRepository.findById(id);
    }
}
