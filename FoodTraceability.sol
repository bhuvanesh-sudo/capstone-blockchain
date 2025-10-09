// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FoodTraceability
 * @notice A transparent traceability contract for frozen food supply chains.
 *         Tracks each product lot through IoT logs and QR tokens.
 *         Supports consumer lookups for farm-to-fork visibility.
 */
contract FoodTraceability {
    /* -------------------------------------------------------------------------- */
    /*                               Data Structures                              */
    /* -------------------------------------------------------------------------- */

    struct IoTRecord {
        int256 temperature;   // recorded temperature (°C)
        string note;          // descriptive note (e.g., "Packed", "In Transit")
        uint256 timestamp;    // block timestamp
    }

    struct Product {
        string name;              // product name
        string origin;            // source or farm
        string certifications;    // certification text
        uint8 stage;              // 0=Registered, 1=Vendor, 2=Manufacturer, 3=Logistics, 4=Retail, 5=Sold
        address handler;          // most recent handler
        string latestQR;          // most recent QR token
        IoTRecord[] logs;         // IoT history
        bool exists;              // existence flag
    }

    // mapping lot number → Product
    mapping(string => Product) private products;

    /* -------------------------------------------------------------------------- */
    /*                                   Events                                   */
    /* -------------------------------------------------------------------------- */

    event ProductRegistered(string indexed lotNumber, string name, string origin);
    event IoTDataCaptured(string indexed lotNumber, int256 temperature, string note, address indexed handler);
    event QRGenerated(string indexed lotNumber, string token, address indexed generator);

    /* -------------------------------------------------------------------------- */
    /*                               Core Functions                               */
    /* -------------------------------------------------------------------------- */

    /**
     * @notice Register a new product lot in the traceability system.
     * @param lotNumber  Unique identifier for the batch/lot.
     * @param name       Product name (e.g., Frozen Peas).
     * @param origin     Source or farm name.
     * @param certifications Certifications or standards (e.g., "Organic").
     */
    function registerProduct(
        string memory lotNumber,
        string memory name,
        string memory origin,
        string memory certifications
    ) public {
        require(bytes(lotNumber).length > 0, "Invalid lot number");
        require(!products[lotNumber].exists, "Product already registered");

        Product storage p = products[lotNumber];
        p.name = name;
        p.origin = origin;
        p.certifications = certifications;
        p.stage = 1; // Vendor stage by default
        p.handler = msg.sender;
        p.exists = true;

        emit ProductRegistered(lotNumber, name, origin);
    }

    /**
     * @notice Capture IoT sensor data for an existing product.
     * @param lotNumber Product lot number.
     * @param temperature Recorded temperature (°C).
     * @param handlingNotes Description or observation (e.g., "In Cold Storage").
     */
    function captureIoTData(
        string memory lotNumber,
        int256 temperature,
        string memory handlingNotes
    ) public {
        require(products[lotNumber].exists, "Unknown product");

        Product storage p = products[lotNumber];
        p.logs.push(IoTRecord({
            temperature: temperature,
            note: handlingNotes,
            timestamp: block.timestamp
        }));
        p.handler = msg.sender;

        emit IoTDataCaptured(lotNumber, temperature, handlingNotes, msg.sender);
    }

    /**
     * @notice Returns all IoT logs for a given product.
     * @param lotNumber Product lot number.
     * @return temps      Array of recorded temperatures.
     * @return notes      Array of corresponding notes.
     * @return timestamps Array of block timestamps.
     */
    function getIoTLogs(string memory lotNumber)
        public
        view
        returns (int256[] memory temps, string[] memory notes, uint256[] memory timestamps)
    {
        require(products[lotNumber].exists, "Unknown product");

        Product storage p = products[lotNumber];
        uint256 count = p.logs.length;

        temps = new int256[](count);
        notes = new string[](count);
        timestamps = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            IoTRecord storage r = p.logs[i];
            temps[i] = r.temperature;
            notes[i] = r.note;
            timestamps[i] = r.timestamp;
        }
    }

    /**
     * @notice Allows consumers to look up product information by lot number.
     * @param lotNumber Product lot number.
     * @return name          Product name.
     * @return origin        Product origin.
     * @return certifications Product certifications.
     * @return stage         Current supply chain stage.
     * @return handler       Current handler address.
     * @return latestQR      Last generated QR token.
     */
    function consumerLookupByLot(string memory lotNumber)
        public
        view
        returns (
            string memory name,
            string memory origin,
            string memory certifications,
            uint8 stage,
            address handler,
            string memory latestQR
        )
    {
        require(products[lotNumber].exists, "Not found");
        Product storage p = products[lotNumber];
        return (p.name, p.origin, p.certifications, p.stage, p.handler, p.latestQR);
    }

    /**
     * @notice Generates a pseudo-random QR token and associates it with a product.
     * @param lotNumber Product lot number.
     * @return token The newly generated QR token string.
     */
    function generateQRToken(string memory lotNumber)
        public
        returns (string memory token)
    {
        require(products[lotNumber].exists, "Not found");

        token = string(
            abi.encodePacked(
                "QR-",
                lotNumber,
                "-",
                uint2str(
                    uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender, lotNumber))) % 100000
                )
            )
        );

        products[lotNumber].latestQR = token;
        products[lotNumber].handler = msg.sender;

        emit QRGenerated(lotNumber, token, msg.sender);
    }

    /* -------------------------------------------------------------------------- */
    /*                                View Helpers                                */
    /* -------------------------------------------------------------------------- */

    /**
     * @notice Get summary info for quick lookups (optional utility).
     */
    function productExists(string memory lotNumber) public view returns (bool) {
        return products[lotNumber].exists;
    }

    /**
     * @notice Convert uint to string (utility for QR generation).
     */
    function uint2str(uint256 _i) internal pure returns (string memory str) {
        if (_i == 0) return "0";
        uint256 j = _i;
        uint256 length;
        while (j != 0) { length++; j /= 10; }
        bytes memory bstr = new bytes(length);
        uint256 k = length;
        j = _i;
        while (j != 0) {
            bstr[--k] = bytes1(uint8(48 + j % 10));
            j /= 10;
        }
        str = string(bstr);
    }
}
