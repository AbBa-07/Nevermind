const { ethers } = require("hardhat");

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 80002n) {
    throw new Error(`Refusing deployment: expected Polygon Amoy (80002), connected to ${network.chainId}.`);
  }

  const Voting = await ethers.getContractFactory("Voting");
  console.log(`Deploying Voting contract to Polygon Amoy from ${network.name}...`);
  const voting = await Voting.deploy();
  await voting.waitForDeployment();

  console.log("Voting contract deployed to:", await voting.getAddress());
  console.log("Save this address as NEXT_PUBLIC_CONTRACT_ADDRESS in frontend/.env.local.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
