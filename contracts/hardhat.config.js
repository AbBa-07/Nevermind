require("@nomicfoundation/hardhat-ethers");
require("dotenv").config();

const amoyRpcUrl = process.env.POLYGON_AMOY_RPC_URL;
const amoyPrivateKey = process.env.POLYGON_AMOY_PRIVATE_KEY;

module.exports = {
  solidity: "0.8.20",
  networks:
    amoyRpcUrl && amoyPrivateKey
      ? {
          polygonAmoy: {
            url: amoyRpcUrl,
            chainId: 80002,
            accounts: [amoyPrivateKey],
          },
        }
      : {},
};