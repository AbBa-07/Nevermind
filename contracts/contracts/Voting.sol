// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Voting {
    struct Candidate {
        uint256 id;
        string name;
        uint256 voteCount;
    }

    mapping(bytes32 => bool) public hasVoted;
    mapping(uint256 => Candidate) public candidates;
    uint256 public candidatesCount;

    event Voted(bytes32 indexed tokenHash, uint256 indexed candidateId);

    constructor() {
        // Initialize 3 default candidates for the hackathon demo
        addCandidate("Candidate #0");
        addCandidate("Candidate #1");
        addCandidate("Candidate #2");
    }

    function addCandidate(string memory name) private {
        candidates[candidatesCount] = Candidate(candidatesCount, name, 0);
        candidatesCount++;
    }

    function castVote(bytes32 tokenHash, uint256 candidateId) external {
        require(!hasVoted[tokenHash], "Error: This voting credential has already been used.");
        require(candidateId < candidatesCount, "Error: Invalid candidate ID.");

        hasVoted[tokenHash] = true;
        candidates[candidateId].voteCount++;

        emit Voted(tokenHash, candidateId);
    }

    // Function for frontend dashboard to fetch live results
    function getCandidates() external view returns (Candidate[] memory) {
        Candidate[] memory list = new Candidate[](candidatesCount);
        for (uint256 i = 0; i < candidatesCount; i++) {
            list[i] = candidates[i];
        }
        return list;
    }
}