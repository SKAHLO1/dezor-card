import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const RPC_URL = process.env.MEZO_RPC_URL ?? "https://rpc.test.mezo.org";

// `pnpm test:fork` (or FORK_MATSNET=1) runs test/fork/* against Mezo's live contracts.
export const FORK_MATSNET =
  !!process.env.FORK_MATSNET || process.argv.some((a) => a.replace(/\\/g, "/").includes("test/fork"));

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./src",
  },
  networks: {
    hardhat: FORK_MATSNET ? { forking: { url: RPC_URL } } : {},
    matsnet: {
      url: RPC_URL,
      chainId: 31611,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
  },
  // Mezo's explorer is Blockscout; it accepts Etherscan-style verification without an API key.
  etherscan: {
    apiKey: { matsnet: "blockscout" },
    customChains: [
      {
        network: "matsnet",
        chainId: 31611,
        urls: {
          apiURL: "https://api.explorer.test.mezo.org/api",
          browserURL: "https://explorer.test.mezo.org",
        },
      },
    ],
  },
  sourcify: { enabled: false },
};

export default config;
