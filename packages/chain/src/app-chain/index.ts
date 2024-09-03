import { ModulesConfig } from "@proto-kit/common";
import {
  AppChainModulesRecord,
  BlockStorageNetworkStateModule,
  InMemorySigner,
  InMemoryTransactionSender,
  StateServiceQueryModule,
} from "@proto-kit/sdk";
import { PrivateKey } from "o1js";

export const baseAppChainModules = {
  Signer: InMemorySigner,
  TransactionSender: InMemoryTransactionSender,
  QueryTransportModule: StateServiceQueryModule,
  NetworkStateTransportModule: BlockStorageNetworkStateModule,
} satisfies AppChainModulesRecord;

export const baseAppChainModulesConfig = {
  Signer: {
    signer: PrivateKey.random(),
  },
  QueryTransportModule: {},
  NetworkStateTransportModule: {},
  TransactionSender: {},
} satisfies ModulesConfig<typeof baseAppChainModules>;
