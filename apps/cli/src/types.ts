export type ComputedTransactionJSON = {
  argsFields: string[];
  methodId: string;
  nonce: string;
  sender: string;
  auxiliaryData: string[];
  hash: string;
};

export type Transaction = {
  status: boolean;
  statusMessage?: string;
  tx: ComputedTransactionJSON;
};

export type ComputedBlockJSON = {
  txs?: Transaction[];
};

export type BlockQueryResponse = {
  data: {
    network: {
      staged: {
        block: {
          height: string;
        };
      };
    };
    block: ComputedBlockJSON;
  };
};

export type MarkeStats = {
  prices: number[];
  volume: {
    last10sEMA: number;
    last1minEMA: number;
    last1hrEMA: number;
  };
};
