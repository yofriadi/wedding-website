## ADDED Requirements

### Requirement: TimelineScroll photos are decoded prior to node reveal

The TimelineScroll component SHALL initiate pre-fetching and decoding of timeline photos when the section approaches the viewport, ensuring that each photo's candidate is decoded before its reveal pop animation executes. If an image is still decoding upon reveal, it SHALL transition smoothly into view rather than popping abruptly.

#### Scenario: Scrubbing into a timeline node displays decoded image

- **WHEN** the user scrubs horizontally into Node 2, Node 3, or Node 4
- **THEN** the photo card reveals the decoded image without an empty-frame flash

#### Scenario: Image transitions smoothly if load is still pending

- **WHEN** a user scrolls rapidly on a slow network such that an image has not finished decoding before its reveal pop completes
- **THEN** the image transitions opacity smoothly from 0 to 1 upon load completion rather than popping abruptly
