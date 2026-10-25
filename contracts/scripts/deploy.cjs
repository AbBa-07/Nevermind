const { ethers } = require("hardhat");

async function main() {
  const Voting = await ethers.getContractFactory("Voting");
  console.log("Deploying Voting contract...");
  const voting = await Voting.deploy();
  await voting.waitForDeployment();

  console.log("Voting contract deployed to:", await voting.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
