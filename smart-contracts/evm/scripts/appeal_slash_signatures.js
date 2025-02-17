const { ethers, utils } = require("ethers");
const fs = require("fs");

const configs = JSON.parse(fs.readFileSync(process.env.CONFIG).toString());
const ABI = JSON.parse(
  fs
    .readFileSync(
      "./artifacts/contracts/" +
        configs.contract_name +
        ".sol/" +
        configs.contract_name +
        ".json"
    )
    .toString()
);
const provider = new ethers.providers.StaticJsonRpcProvider(configs.provider);
let wallet = new ethers.Wallet(configs.owner_key).connect(provider);
const contract = new ethers.Contract(configs.contract_address, ABI.abi, wallet);

const deal_index = 1;
let referees_signatures = [];
let referees_addresses = [];
let slashed = false;

async function processRounds() {
  referees_signatures = [];
  referees_addresses = [];
  slashed = false;
  const deal = await contract.deals(deal_index);
  const appeal_index = await contract.active_appeals(deal);
  const round = await contract.getRound(appeal_index);
  console.log("Round is:", round.toString());
  const leader = await contract.getElectedLeader(deal_index);
  console.log("Leader is:", leader);
  const threshold = parseInt(
    (await contract.refereeConsensusThreshold()).toString()
  );
  console.log("Threshold to find consensus:", threshold);
  for (let k in configs.referees) {
    const refereeWallet = new ethers.Wallet(configs.referees[k].key).connect(
      provider
    );
    const refereeContract = new ethers.Contract(
      configs.contract_address,
      ABI.abi,
      refereeWallet
    );
    const prefix = await refereeContract.getPrefix(deal_index);
    // Create hashed version of message
    const message = ethers.utils.arrayify(prefix);
    const hashedMessage = await ethers.utils.hashMessage(message);
    console.log("Hashed message:", hashedMessage);
    // Sign message
    const signature = await refereeWallet.signMessage(message);
    // Run double check
    const verified = await refereeContract.verifyRefereeSignature(
      signature,
      deal_index,
      refereeWallet.address
    );
    if (verified) {
      console.log("Signature is verified");
      referees_signatures.push(signature);
      referees_addresses.push(refereeWallet.address);
    }
    let parsedSignaturesCount = referees_signatures.length * 100;
    console.log("Collected signatures:", parsedSignaturesCount);
    if (parsedSignaturesCount >= threshold && !slashed) {
      console.log("Collected enough signatures, trying slash.");
      try {
        const slashTransaction = await refereeContract.processAppeal(
          deal_index,
          referees_addresses,
          referees_signatures
        );
        console.log("Pending transaction at: " + slashTransaction.hash);
        await slashTransaction.wait();
        console.log("Provider successfully slashed.");
        slashed = true;

        const updatedAppeal = await refereeContract.appeals(deal_index);
        console.log("Updated appeal:", updatedAppeal);
        console.log("Waiting for 30s then starting again process..");
      } catch (e) {
        console.log(e.message);
      }
    }
  }
  if (round.toString() === "99") {
    console.log("Appeal ended.");
    process.exit();
  }
}

async function main() {
  try {
    const round = await contract.getRound(deal_index);
    if (round.toString() !== "99") {
      processRounds();
      setInterval(function () {
        processRounds();
      }, 15000);
    } else {
      const appeal = await contract.appeals(deal_index);
      console.log("Appeal closed, slashes are:", appeal.slashes.toString());
      console.log(appeal);
    }
  } catch (e) {
    console.log(e);
    console.log("Can't get round, check transaction.");
  }
}

main();
