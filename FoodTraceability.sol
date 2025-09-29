// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FoodTraceabilityFull
 * @notice End-to-end frozen food traceability with QR simulation and gamification badges.
 *
 * How to use in Remix:
 * 1. Create `FoodTraceabilityFull.sol` and paste this code.
 * 2. Compile with Solidity 0.8.20.
 * 3. Deploy (account deploying becomes owner).
 * 4. Use owner-only functions to assign roles, register products, and optionally set thresholds.
 * 5. Use role accounts to update stages/capture IoT logs.
 * 6. Use generateQR to create a QR token; consumer can call consumerLookupByQR(token).
 */

contract FoodTraceabilityFull {
    // ------------------------
    // Basic types & storage
    // ------------------------
    enum Stage { Created, Vendor, Manufacturing, Logistics, Retail, Completed }
    enum Role { None, Vendor, Manufacturer, Logistics, Retailer }

    struct IoTData {
        int256 temperature; // Celsius (can be negative)
        string handlingNotes;
        uint256 timestamp;
    }

    struct Product {
        string lotNumber;
        string name;
        string origin;
        string certifications; // e.g., "Organic;MSC;FairTrade"
        Stage stage;
        address currentHandler;
        IoTData[] transportLogs;
        bool exists;
        int256 minTemp; // allowed min temperature (if 0 and minTempSet=false, ignored)
        int256 maxTemp; // allowed max temperature (if 0 and maxTempSet=false, ignored)
        bool minTempSet;
        bool maxTempSet;
    }

    address public owner;

    // lotNumber => Product
    mapping(string => Product) private products;
    mapping(string => bool) private registeredLots;

    // Roles management: address => Role
    mapping(address => Role) public roles;

    // QR token (simulated) => lotNumber
    mapping(string => string) private qrToLot;
    mapping(string => string) private lotToQr; // last generated QR for a lot

    // Gamification: lotNumber => badgeName => awarded (true/false)
    mapping(string => mapping(string => bool)) private badges;
    // For quick listing we store badge names per lot (small array)
    mapping(string => string[]) private badgeListByLot;

    // ------------------------
    // Events
    // ------------------------
    event ProductRegistered(string indexed lotNumber, string name, string origin);
    event StageUpdated(string indexed lotNumber, Stage stage, address handler);
    event IoTDataCaptured(string indexed lotNumber, int256 temperature, string notes);
    event QRGenerated(string indexed lotNumber, string qrToken);
    event BadgeAwarded(string indexed lotNumber, string badgeName);
    event RoleAssigned(address indexed account, Role role);
    event ThresholdsSet(string indexed lotNumber, int256 minTemp, int256 maxTemp);

    // ------------------------
    // Modifiers
    // ------------------------
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier productExists(string memory lotNumber) {
        require(registeredLots[lotNumber], "Product not registered");
        _;
    }

    modifier onlyRoleForStage(Stage stageRequired) {
        Role r = roles[msg.sender];
        if (stageRequired == Stage.Vendor) {
            require(r == Role.Vendor, "Only Vendor role allowed");
        } else if (stageRequired == Stage.Manufacturing) {
            require(r == Role.Manufacturer, "Only Manufacturer role allowed");
        } else if (stageRequired == Stage.Logistics) {
            require(r == Role.Logistics, "Only Logistics role allowed");
        } else if (stageRequired == Stage.Retail) {
            require(r == Role.Retailer, "Only Retailer role allowed");
        } else {
            revert("Invalid role requirement");
        }
        _;
    }

    // ------------------------
    // Constructor
    // ------------------------
    constructor() {
        owner = msg.sender;
        roles[msg.sender] = Role.None; // owner has no supply-chain role by default
    }

    // ------------------------
    // Role management
    // ------------------------
    function assignRole(address account, Role role) external onlyOwner {
        roles[account] = role;
        emit RoleAssigned(account, role);
    }

    // ------------------------
    // Product lifecycle
    // ------------------------
    /// Register a new product (anyone can register in this demo; in production restrict to trusted accounts)
    function registerProduct(
        string memory lotNumber,
        string memory name,
        string memory origin,
        string memory certifications
    ) external {
        require(!registeredLots[lotNumber], "Lot already registered");
        Product storage p = products[lotNumber];
        p.lotNumber = lotNumber;
        p.name = name;
        p.origin = origin;
        p.certifications = certifications;
        p.stage = Stage.Created;
        p.currentHandler = msg.sender;
        p.exists = true;
        registeredLots[lotNumber] = true;

        emit ProductRegistered(lotNumber, name, origin);
    }

    /// Owner or designated role can set temperature thresholds for a lot (optional)
    function setTemperatureThresholds(
        string memory lotNumber,
        int256 minTemp,
        int256 maxTemp
    ) external productExists(lotNumber) {
        require(msg.sender == owner || roles[msg.sender] != Role.None, "Only owner or role");
        Product storage p = products[lotNumber];
        p.minTemp = minTemp;
        p.maxTemp = maxTemp;
        p.minTempSet = true;
        p.maxTempSet = true;
        emit ThresholdsSet(lotNumber, minTemp, maxTemp);
    }

    /// Update stage — must move forward (Created -> Vendor -> Manufacturing -> Logistics -> Retail -> Completed)
    /// Only the address with the appropriate role should call updateStage for that stage (enforced).
    function updateStage(string memory lotNumber, Stage newStage) external productExists(lotNumber) {
        Product storage p = products[lotNumber];

        // ensure forward progression
        require(uint(newStage) > uint(p.stage), "Invalid stage transition (must progress forward)");

        // enforce role: the caller must have the role corresponding to the newStage (except Created)
        if (newStage == Stage.Vendor) {
            require(roles[msg.sender] == Role.Vendor, "Must be Vendor");
        } else if (newStage == Stage.Manufacturing) {
            require(roles[msg.sender] == Role.Manufacturer, "Must be Manufacturer");
        } else if (newStage == Stage.Logistics) {
            require(roles[msg.sender] == Role.Logistics, "Must be Logistics");
        } else if (newStage == Stage.Retail) {
            require(roles[msg.sender] == Role.Retailer, "Must be Retailer");
        } else if (newStage == Stage.Completed) {
            // allow owner or retailer to mark completed
            require(msg.sender == owner || roles[msg.sender] == Role.Retailer, "Must be owner or retailer to complete");
        } else {
            revert("Unsupported stage");
        }

        p.stage = newStage;
        p.currentHandler = msg.sender;

        emit StageUpdated(lotNumber, newStage, msg.sender);

        // optional auto-award: when product reaches Retail stage and certification contains "Sustainable", auto-award badge
        if (newStage == Stage.Retail) {
            if (_containsCertification(p.certifications, "Sustainable") && !_hasBadge(lotNumber, "Sustainable")) {
                _awardBadgeInternal(lotNumber, "Sustainable");
            }
        }
    }

    // ------------------------
    // IoT data capture
    // ------------------------
    function captureIoTData(
        string memory lotNumber,
        int256 temperature,
        string memory handlingNotes
    ) external productExists(lotNumber) {
        // require caller to have Logistics role to capture IoT logs (but allow owner)
        require(msg.sender == owner || roles[msg.sender] == Role.Logistics, "Only Logistics or owner can upload IoT data");

        products[lotNumber].transportLogs.push(IoTData({
            temperature: temperature,
            handlingNotes: handlingNotes,
            timestamp: block.timestamp
        }));

        emit IoTDataCaptured(lotNumber, temperature, handlingNotes);
    }

    // ------------------------
    // QR simulation (generate token string — stored on-chain)
    // ------------------------
    function generateQRToken(string memory lotNumber) external productExists(lotNumber) returns (string memory) {
        // Only owner or currentHandler can generate QR for that lot
        Product storage p = products[lotNumber];
        require(msg.sender == owner || msg.sender == p.currentHandler, "Only owner or current handler");

        // Create pseudo-random token: keccak256(lot + sender + block.timestamp + nonce)
        bytes32 raw = keccak256(abi.encodePacked(lotNumber, msg.sender, block.timestamp));
        string memory token = _toHexString(raw);

        qrToLot[token] = lotNumber;
        lotToQr[lotNumber] = token;

        emit QRGenerated(lotNumber, token);
        return token;
    }

    /// Consumer lookup by QR token (simulate scanning)
    function consumerLookupByQR(string memory qrToken)
        external
        view
        returns (
            string memory lotNumber,
            string memory name,
            string memory origin,
            string memory certifications,
            Stage stage,
            address handler
        )
    {
        string memory lot = qrToLot[qrToken];
        require(bytes(lot).length != 0, "Invalid QR token");
        Product storage p = products[lot];
        return (p.lotNumber, p.name, p.origin, p.certifications, p.stage, p.currentHandler);
    }

    /// Consumer lookup by lotNumber (direct)
    function consumerLookupByLot(string memory lotNumber)
        external
        view
        productExists(lotNumber)
        returns (
            string memory name,
            string memory origin,
            string memory certifications,
            Stage stage,
            address handler,
            string memory latestQR
        )
    {
        Product storage p = products[lotNumber];
        return (p.name, p.origin, p.certifications, p.stage, p.currentHandler, lotToQr[lotNumber]);
    }

    // ------------------------
    // Badges (gamification)
    // ------------------------
    /// Owner or product handler can manually award a badge
    function awardBadge(string memory lotNumber, string memory badgeName) external productExists(lotNumber) {
        Product storage p = products[lotNumber];
        require(msg.sender == owner || msg.sender == p.currentHandler, "Only owner or handler");
        require(!_hasBadge(lotNumber, badgeName), "Badge already awarded");
        _awardBadgeInternal(lotNumber, badgeName);
    }

    function _awardBadgeInternal(string memory lotNumber, string memory badgeName) internal {
        badges[lotNumber][badgeName] = true;
        badgeListByLot[lotNumber].push(badgeName);
        emit BadgeAwarded(lotNumber, badgeName);
    }

    function _hasBadge(string memory lotNumber, string memory badgeName) internal view returns (bool) {
        return badges[lotNumber][badgeName];
    }

    /// View badges for a lot
    function getBadges(string memory lotNumber) external view productExists(lotNumber) returns (string[] memory) {
        return badgeListByLot[lotNumber];
    }

    // ------------------------
    // Compliance & analytics
    // ------------------------
    /// Check if product's transport logs are within thresholds (returns true if compliant or no thresholds set)
    function checkTemperatureCompliance(string memory lotNumber) public view productExists(lotNumber) returns (bool) {
        Product storage p = products[lotNumber];

        if (!p.minTempSet && !p.maxTempSet) {
            // no thresholds set = treat as compliant
            return true;
        }

        for (uint i = 0; i < p.transportLogs.length; i++) {
            int256 t = p.transportLogs[i].temperature;
            if (p.minTempSet && t < p.minTemp) {
                return false;
            }
            if (p.maxTempSet && t > p.maxTemp) {
                return false;
            }
        }
        return true;
    }

    /// Analytics summary: totalLogs, avgTemp (scaled), minTemp, maxTemp, compliant
    /// Note: avgTemp returned as int256 (floor) using integer division
    function getAnalytics(string memory lotNumber) external view productExists(lotNumber)
        returns (
            uint256 totalLogs,
            int256 avgTemp,
            int256 minTemp,
            int256 maxTemp,
            bool compliant
        )
    {
        Product storage p = products[lotNumber];
        uint256 n = p.transportLogs.length;
        if (n == 0) {
            return (0, 0, 0, 0, checkTemperatureCompliance(lotNumber));
        }

        int256 sum = 0;
        int256 minT = p.transportLogs[0].temperature;
        int256 maxT = p.transportLogs[0].temperature;

        for (uint i = 0; i < n; i++) {
            int256 t = p.transportLogs[i].temperature;
            sum += t;
            if (t < minT) { minT = t; }
            if (t > maxT) { maxT = t; }
        }

        int256 average = sum / int256(n);
        bool c = checkTemperatureCompliance(lotNumber);
        return (n, average, minT, maxT, c);
    }

    // ------------------------
    // Helpers
    // ------------------------
    function _containsCertification(string memory certs, string memory key) internal pure returns (bool) {
        // naive substring check
        bytes memory a = bytes(certs);
        bytes memory b = bytes(key);
        if (a.length < b.length) return false;
        for (uint i = 0; i <= a.length - b.length; i++) {
            bool match_ = true;
            for (uint j = 0; j < b.length; j++) {
                if (a[i+j] != b[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }

    // Convert bytes32 to hex string (lowercase, 0x prefixed) — used for QR token generation
    function _toHexString(bytes32 data) internal pure returns (string memory) {
        bytes16 hexSymbols = "0123456789abcdef";
        bytes memory str = new bytes(2 + 64);
        str[0] = '0';
        str[1] = 'x';
        for (uint i = 0; i < 32; i++) {
            str[2 + i * 2] = hexSymbols[uint8(data[i]) >> 4];
            str[2 + i * 2 + 1] = hexSymbols[uint8(data[i]) & 0x0f];
        }
        return string(str);
    }

    // ------------------------
    // Getter for IoT logs (returns arrays by splitting into separate arrays to avoid dynamic array of structs return issues)
    // ------------------------
    function getIoTLogs(string memory lotNumber) external view productExists(lotNumber)
        returns (int256[] memory temps, string[] memory notes, uint256[] memory timestamps)
    {
        Product storage p = products[lotNumber];
        uint256 n = p.transportLogs.length;
        temps = new int256[](n);
        notes = new string[](n);
        timestamps = new uint256[](n);

        for (uint i = 0; i < n; i++) {
            temps[i] = p.transportLogs[i].temperature;
            notes[i] = p.transportLogs[i].handlingNotes;
            timestamps[i] = p.transportLogs[i].timestamp;
        }
        return (temps, notes, timestamps);
    }

    // ------------------------
    // Small utility: check if badge exists (public)
    // ------------------------
    function hasBadge(string memory lotNumber, string memory badgeName) external view productExists(lotNumber) returns (bool) {
        return badges[lotNumber][badgeName];
    }
}
