import { Balance, VanillaRuntimeModules } from "@proto-kit/library";
import { ModulesConfig } from "@proto-kit/common";

import { Balances } from "./modules/balances";
import { Dex } from "./modules/dex";

export const modules = VanillaRuntimeModules.with({
  Balances,
  Dex,
});

export const config: ModulesConfig<typeof modules> = {
  Balances: {},
  Dex: {},
};

export default {
  modules,
  config,
};
