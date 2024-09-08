# Beat-Ex

A Dex using Frequent Batch Auctions (FBA) for order settlement.

Decentralised exchanges (DEXs) have revolutionised cryptocurrency trading, offering permissionless access and eliminating the need for centralised intermediaries. It's a step up from the traditional exchanges (which are permissioned), providing greater accessibility and transparency to users. But a critical flaw still remains, one that threatens the fairness and efficiency of these platforms.
These platforms are vulnerable to various forms of MEV, like frontrunning, backrunning, and sandwich attacks, snipping. These flaws can be largely attributed to the continuous-time nature of current DEX designs, where the ordering of transactions within a block matters significantly. This allows one to extract value from other users' transactions risk-free, at the expense of regular traders and liquidity providers, without benefiting the market in any way.

Beat-Ex implements a new order matching mechanism called Frequent Batch Auctions (FBA). FBAs divide time into discrete steps or batches (e.g., 1 s or 100 ms). During each interval, incoming orders are collected and then matched at a uniform clearing price, thus effectively nullifying any advantage from ordering transactions. By treating all orders within a batch equally, FBAs create a more level playing field for all participants.

In fact, FBAs were originally proposed as a solution to the problem of high-frequency trading (HFT) in traditional finance. One can draw clear parallels between the challenges faced by traditional financial markets due to the value-extractive nature of HFT and the MEV landscape in current dex design. In traditional markets, high-frequency traders can gain disproportionate advantages with a minute edge in latency, leading to a costly technological arms race that negatively impacts market efficiency and price discovery. Similarly, MEV extraction from dex transactions creates an environment where the ability to influence ordering of transactions at the L1 layer often takes precedence over genuine price discovery and fair market participation, distorting the incentives of the market participants.

The idea for Beat-Ex was inspired by a talk by Eric Budish [link](https://www.youtube.com/watch?v=OwQjTedWSUM)

- `packages/chain` contains everything related to your app-chain
- `apps/web` WIP
- `apps/cli` CLI to interact with the chain

**Prerequisites:**

- Node.js `v18` (we recommend using NVM)
- pnpm `v9.8`
- nvm

For running with persistance / deploying on a server

- docker `>= 24.0`
- docker-compose `>= 2.22.0`

## Setup

- run `pnpm env:inmemory dev --filter chain` from root to run the sequencer
- run cli using `pnpm dev --filter cli`
- scripts in `packages/chain/scripts/*` can be run using `run dev:bot [scriptName]`
