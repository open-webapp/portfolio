import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetAnalytics } from "./BudgetAnalytics";
import { initialState } from "../lib/state";

describe("BudgetAnalytics derived income", () => {
  it("does not render spend analytics for Income-only records", () => {
    const year = String(new Date().getFullYear());
    render(
      <BudgetAnalytics
        state={{
          ...initialState(),
          budgetTransactions: [
            {
              id: "pay",
              date: `${year}-01-01`,
              description: "Pay",
              categoryId: "income",
              amount: 1000,
            },
          ],
        }}
        categories={[{ id: "income", name: "Income", updatedAt: "" }]}
      />,
    );
    expect(screen.getAllByText("No records for this period.")).toHaveLength(12);
    expect(screen.getAllByTestId("concern-card")).toHaveLength(5);
  });

  it("renders populated concern and mover cards independently", () => {
    const year = new Date().getFullYear();
    const state = initialState();
    state.budgetTransactions = [
      {
        id: "food-last",
        date: `${year - 1}-01-01`,
        description: "Food",
        categoryId: "food",
        amount: -100,
      },
      {
        id: "travel-last",
        date: `${year - 1}-01-01`,
        description: "Travel",
        categoryId: "travel",
        amount: -200,
      },
      {
        id: "food-this",
        date: `${year}-01-01`,
        description: "Food",
        categoryId: "food",
        amount: -300,
      },
      {
        id: "travel-this",
        date: `${year}-01-01`,
        description: "Travel",
        categoryId: "travel",
        amount: -50,
      },
    ];

    const view = render(
      <BudgetAnalytics
        state={state}
        categories={[
          { id: "food", name: "Food", updatedAt: "" },
          { id: "travel", name: "Travel", updatedAt: "" },
        ]}
      />,
    );

    expect(
      view.container.querySelectorAll('[data-testid="concern-card"]'),
    ).toHaveLength(5);
    expect(
      view.container.querySelectorAll('[data-testid="concern-alert-icon"]')
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(view.container.textContent).toContain(
      "Biggest increases vs last year",
    );
    expect(view.container.textContent).toContain(
      "Biggest decreases vs last year",
    );
  });
});
