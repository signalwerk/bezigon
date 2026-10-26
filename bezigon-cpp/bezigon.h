// This file is part of Bezigon, released under the MIT License.
// See LICENSE for details.
//
// Diese Datei ist Teil von Bezigon und steht unter der MIT-Lizenz.
// Siehe LICENSE für Einzelheiten.

// bezigon.h
// Bezigon handle computation. Depends only on the C++ standard library.
//
// A path is a list of nodes. Every node has two Bezier handles: an
// in-handle (toward the previous node) and an out-handle (toward the
// next node). Neighbouring nodes share a cubic Bezier segment:
//
//     segment i -> i+1  =  node[i], node[i] + out, node[i+1] + in, node[i+1]
//
// Typical use:
//
//     bezigon::Path path;
//     path.nodes.push_back(bezigon::make_node(x, y, type));   // after each click
//     bezigon::compute_handles(path);            // after ANY change to the nodes
//
//     bezigon::close_path(path, withModifier);   // click on the start node
//     bezigon::compute_handles(path);
//
//     bezigon::set_node_type(path, i, type);     // change a node's type
//     bezigon::drag_handle(path, i, isIn, x, y); // user drags a handle tip
//
// See bezigon.cpp for the rules behind each node type.

#pragma once
#include <vector>

#define BEZIGON_VERSION "4.2.0"

namespace bezigon {

// How a node shapes the path.
//
//   Corner   Plain click. The path may turn sharply here. Its handles can be
//            dragged straight away: a side with nothing to follow lies along
//            the chord, which draws a straight line.
//   Smooth   Modifier click. The path flows through the node on a curve.
//   Tangent  FreeHand's "connector point". Each of its handles continues the
//            chord on the other side of the node, so only the handle's
//            length is free.
enum class NodeType { Corner, Smooth, Tangent };

// How a path is closed.
//   Open      Not closed.
//   Plain     Closed by a plain click on the start node.
//   Modifier  Closed by a modifier click on the start node. This turns the
//             start node into a Corner (see close_path).
enum class Close { Open, Plain, Modifier };

// A path node.
//
//   x, y            position
//   type            what the user chose for the node
//   cusp            Corner nodes only: true if the corner came from converting
//                   a Smooth or Tangent node (see set_node_type, close_path).
//                   A cusp's handles lie along its chords; a plain Corner
//                   continues its neighbours' arcs.
//   hx_in, hy_in    offset from the node to its incoming control point
//   hx_out, hy_out  offset from the node to its outgoing control point
//                   (0, 0) means "no handle". Only a Tangent's straight side
//                   and a side with no neighbour have none; every other side
//                   gets a handle, lying along the chord when it has nothing
//                   to follow, which draws a straight line. Use
//                   segment_is_straight to tell a drawn line from a curve.
//
//   manual_in, manual_out
//                   true once the user has dragged that handle, or a Tangent
//                   became a cusp and kept it. A manual handle is never
//                   recomputed (on a Tangent node its direction still
//                   follows the rule; its length is kept).

struct Node
{
    double   x = 0.0, y = 0.0;
    NodeType type = NodeType::Corner;
    bool     cusp       = false;
    bool     manual_in  = false;
    bool     manual_out = false;
    double   hx_in  = 0.0, hy_in  = 0.0;
    double   hx_out = 0.0, hy_out = 0.0;
};

// A new node of the given type, as created by a click.
inline Node make_node(double x, double y, NodeType type)
{
    Node n;
    n.x = x;  n.y = y;  n.type = type;
    return n;
}

// A path: its nodes in order, and how it is closed.
//
// The close state is read with close() and set only by close_path. A modifier
// close also turns the start node into a Corner, and doing both in one call
// means the start node and the close state can never disagree. To reopen a
// path, copy its nodes into a new Path.
class Path
{
public:
    std::vector<Node> nodes;

    Close close() const { return close_; }

private:
    Close close_ = Close::Open;
    friend bool close_path(Path& path, bool withModifier);
};

struct Options
{
    // Length of each automatic handle as a fraction of its own segment.
    double handleFraction = 0.39;
};

// Close the path. Returns false, and changes nothing, if there are fewer
// than two nodes. Closing with the modifier also turns the start node into
// a Corner (a cusp, if it was Smooth or Tangent). Call compute_handles
// afterwards.
//
// Two nodes close into a loop of two segments. Each node then has the other
// on both sides, and a Smooth node points square to the chord, so a plain
// close of two Smooth nodes draws an ellipse (as Xara does). A modifier close
// makes the start node a cusp, which lies along the chord instead.
bool close_path(Path& path, bool withModifier);

// Change a node's type and recompute. Use this rather than assigning
// Node::type, because it also decides what happens to the handles:
//   to Smooth or Tangent   the handles are reset to the automatic ones.
//   to Corner              the node becomes a cusp, however it was drawn:
//                          its handles lie along the chords to its
//                          neighbours, except that a Tangent's own handles
//                          survive the conversion.
// So any node toggles between smooth and the same cusp every time. A plain
// (arc-following) Corner comes only from a plain click. A type equal to the
// current one is ignored, and so are out-of-range indices.
void set_node_type(Path& path, int index, NodeType type,
                   const Options& opts = Options());

// Recompute every handle that is not manual. Call after any change to a
// node position or a node type, and after close_path.
void compute_handles(Path& path, const Options& opts = Options());

// True if the segment from node `index` to the next one is drawn as a
// straight line, because both of its handles lie along it. Export such a
// segment as a line rather than a curve. False if no segment starts here.
bool segment_is_straight(const Path& path, int index);

// Where a Tangent node's handle may be pulled out. Returns true and the unit
// direction (ax, ay) the handle points, or false if the node is not a Tangent
// or has no neighbour to take the direction from.
bool handle_axis(const Path& path, int index, bool isIn,
                 double& ax, double& ay);

// Move one handle tip to (x, y) and mark that handle manual, then update
// whatever depends on it. Out-of-range indices are ignored.
//   Smooth   the opposite handle is turned to stay collinear (length kept)
//            and is marked manual too, unless it has zero length.
//   Tangent  only the handle's length is taken from (x, y); a handle can
//            only be created where handle_axis gives a direction.
//   Corner   the opposite handle is untouched.
void drag_handle(Path& path, int index, bool isIn, double x, double y,
                 const Options& opts = Options());

}   // namespace bezigon
