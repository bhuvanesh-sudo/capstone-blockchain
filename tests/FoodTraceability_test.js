const { expect } = require("chai");

let FoodTraceability, traceContract;
let owner, vendor, manufacturer, logistics, retailer, consumer;

describe("FoodTraceabilityFull", function () {

  before(async function () {
    // Get test accounts
    [owner, vendor, manufacturer, logistics, retailer, consumer] = await ethers.getSigners();

    // Deploy the contract
    const Factory = await ethers.getContractFactory("FoodTraceabilityFull");
    traceContract = await Factory.deploy();
    await traceContract.waitForDeployment();
    FoodTraceability = traceContract;
  });

  it("Owner should assign roles correctly", async function () {
    await FoodTraceability.connect(owner).assignRole(vendor.address, 1);        // Vendor
    await FoodTraceability.connect(owner).assignRole(manufacturer.address, 2);  // Manufacturer
    await FoodTraceability.connect(owner).assignRole(logistics.address, 3);     // Logistics
    await FoodTraceability.connect(owner).assignRole(retailer.address, 4);      // Retailer

    // Convert BigInt to Number before comparing
    const roleValue = (await FoodTraceability.getUserRole(vendor.address)).toString();
    expect(Number(roleValue)).to.equal(1);
  });

  it("Vendor should register a product successfully", async function () {
    await FoodTraceability.connect(vendor).registerProduct(
      "LOT123",
      "Rich Frozen Pizza",
      "Chennai",
      "FSSAI;ISO9001"
    );
    const stage = await FoodTraceability.getProductStage("LOT123");
    expect(Number(stage.toString())).to.equal(0); // Stage.Created
  });

  it("Stages should progress correctly through supply chain", async function () {
    await FoodTraceability.connect(vendor).progressStage("LOT123");         // Vendor -> Manufacturing
    await FoodTraceability.connect(manufacturer).progressStage("LOT123");   // Manufacturing -> Logistics
    await FoodTraceability.connect(logistics).progressStage("LOT123");      // Logistics -> Retail
    await FoodTraceability.connect(retailer).progressStage("LOT123");       // Retail -> Completed

    const finalStage = await FoodTraceability.getProductStage("LOT123");
    expect(Number(finalStage.toString())).to.equal(4); // Stage.Retail
  });

  it("Should allow IoT data logging and retrieval", async function () {
    await FoodTraceability.connect(logistics).addIoTData(
      "LOT123",
      -18,
      "Maintained frozen chain"
    );

    const logs = await FoodTraceability.getIoTLogs("LOT123");
    expect(logs.length).to.be.greaterThan(0);

    // Convert BigInt to normal number for comparison
    const firstLog = logs[0];
    expect(Number(firstLog.temperature.toString())).to.equal(-18);
    expect(firstLog.handlingNotes).to.equal("Maintained frozen chain");
  });

  it("Should generate QR and allow consumer lookup", async function () {
    await FoodTraceability.connect(owner).generateQR("LOT123", "QRPIZZA2025");

    const product = await FoodTraceability.consumerLookupByQR("QRPIZZA2025");
    expect(product.name).to.equal("Rich Frozen Pizza");
    expect(product.origin).to.equal("Chennai");
  });

});
