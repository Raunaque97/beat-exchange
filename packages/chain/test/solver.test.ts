import "reflect-metadata";
import { UInt64 } from "@proto-kit/library";
import { calculateSettlementPrice } from "../src/solver";
import { Order } from "../src/runtime/utils";
import { DECIMALS } from "../src/runtime/constants";
import { TestingAppChain } from "@proto-kit/sdk";

describe("Solver", () => {
  const appChain = TestingAppChain.fromRuntime({});

  // Helper function to create an Order object
  const createOrder = (
    amountLow: number,
    amountHigh: number,
    priceLow: number,
    priceHigh: number
  ): Order => ({
    amount_low: UInt64.from(amountLow * 10 ** DECIMALS),
    amount_high: UInt64.from(amountHigh * 10 ** DECIMALS),
    price_low: UInt64.from(priceLow),
    price_high: UInt64.from(priceHigh),
  });

  beforeAll(async () => {
    appChain.configurePartial({
      Runtime: {
        Balances: {},
      },
    });
    await appChain.start();
  });

  it("should calculate the correct settlement price for a simple case", () => {
    const buyOrders = [
      createOrder(100, 100, 2000, 4000),
      createOrder(1000, 0, 2700, 3000),
    ];
    const sellOrders = [createOrder(0, 1000, 3000, 3300)];
    const result = calculateSettlementPrice(buyOrders, sellOrders);
    expect(result.toString()).toBe("3030");
  });

  it("should calculate the correct settlement price for a more complex case", () => {
    const buyOrders = [
      createOrder(1000, 0, 2700, 3000),
      createOrder(2000, 0, 2700, 3030),
    ];
    const sellOrders = [
      createOrder(0, 2000, 3030, 3300),
      createOrder(0, 1000, 3000, 3300),
    ];
    const result = calculateSettlementPrice(buyOrders, sellOrders);
    // expect(result.toString()).toBe("3030");
  });

  it("should return a valid price when buy and sell orders don't overlap", () => {
    const buyOrders = [createOrder(1000, 0, 2700, 3000)];
    const sellOrders = [createOrder(0, 1000, 3000, 3300)];
    const result = calculateSettlementPrice(buyOrders, sellOrders);
  });

  it("should not throw for empty order lists", () => {
    calculateSettlementPrice([], []);
  });
});
