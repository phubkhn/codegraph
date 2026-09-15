package com.example.loan;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class LoanService {
    private final LoanRepository loanRepository;

    @Autowired
    private NotificationService notificationService;

    public LoanService(LoanRepository loanRepository) {
        this.loanRepository = loanRepository;
    }

    public void disburse(Long id) {
        loanRepository.save(id);
        notificationService.notify(id);
    }
}
