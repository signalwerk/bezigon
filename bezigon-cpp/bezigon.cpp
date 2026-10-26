// This file is part of Bezigon, released under the MIT License.
// See LICENSE for details.
//
// Diese Datei ist Teil von Bezigon und steht unter der MIT-Lizenz.
// Siehe LICENSE für Einzelheiten.

// bezigon.cpp
// Handle computation for the Bezigon tool.
//
// Each automatic handle is handleFraction times the length of its own
// segment, so only its direction needs deciding. That depends on the node
// type.
//
//   Smooth    The path follows the tangent of the circle through previous,
//             node and next. A missing neighbour (an end of an open path)
//             drops out of the formula, so an end node simply points along
//             its one chord. If previous and next are the same point there
//             is no such circle:
//               - in a closed path of exactly two nodes, both neighbours are
//                 the one other node. The node points square to the chord,
//                 so the two nodes draw an ellipse, as Xara does.
//               - anywhere else (two separate nodes that happen to sit on one
//                 point) nothing special happens: each handle lies along its
//                 chord, as in FreeHand, until the nodes are moved apart.
//
//   Corner    Each side is decided on its own. If the neighbour on that
//             side is Smooth, continue its arc: reflect the neighbour's
//             direction across the chord. A Tangent's handle is not
//             followed, even one the user pulled out. Otherwise
//             the handle lies along the chord, which draws the side as a
//             straight line and still gives the user something to pull.
//             Only a side with no neighbour, beyond the end of an open path,
//             has no handle at all.
//
//   Cusp      A Corner made by converting a Smooth or Tangent node. It
//             follows none of its neighbours: each handle simply lies along
//             its own chord, so the node is a point with a straight approach
//             on each side. A Tangent's own handles survive the conversion,
//             as dragged ones; see set_node_type.
//
//   Tangent   FreeHand's connector point. Each handle continues the chord on
//             the other side of the node:
//                 out-handle points along   node - previous
//                 in-handle  points along   node - next
//             At an end of an open path there is no chord on the other side,
//             so the handle points along the chord to its one neighbour.
//             The two handles are therefore not collinear in general, and a
//             Tangent between curves makes a notch. Only the length of a
//             Tangent handle is free. A side has a handle if
//               - the segment is already curved by the neighbour, meaning it
//                 is Smooth or has a dragged handle facing this node
//                 (automatic), or
//               - the user pulled one out (handle_axis gives the direction).
//             A handle on a straight segment would bend it, so toward a
//             plain Corner the segment stays straight, and a Tangent between
//             two such nodes is a polygon corner until a handle is pulled.
//
//   Modifier close
//             The start node is made by two clicks, and each handle is
//             made as if its click ended an open path. Closing turns the
//             start node into a Corner: a cusp if it was Smooth or Tangent.
//             As long as it is a Corner, its in-handle points straight at the
//             last node. Its out-handle follows the Corner or cusp rule.
//
// A node's "heading" is its direction of travel along the path. Everything
// a node's handles depend on is worked out first (analyse), from positions
// and node types only, and handles are written second.

#include "bezigon.h"
#include <cmath>

namespace bezigon {
namespace {

const double EPS = 1e-9;

// Sides of a node, named by the neighbour they face.
const int PREV = 0;
const int NEXT = 1;

struct Vec
{
    double x, y;
    Vec(double x_ = 0.0, double y_ = 0.0) : x(x_), y(y_) {}
};

Vec operator+(Vec a, Vec b)    { return Vec(a.x + b.x, a.y + b.y); }
Vec operator-(Vec a, Vec b)    { return Vec(a.x - b.x, a.y - b.y); }
Vec operator*(double k, Vec v) { return Vec(k * v.x, k * v.y); }
double dot(Vec a, Vec b)       { return a.x * b.x + a.y * b.y; }

// Scale v to unit length. False, with v untouched, if it is shorter than
// minLength.
bool normalise(Vec& v, double minLength)
{
    const double l = std::hypot(v.x, v.y);
    if (l < minLength) return false;
    v = (1.0 / l) * v;
    return true;
}

// One side of a node: its neighbour, and where that neighbour lies.
struct Link
{
    int    node = -1;      // neighbour index, or -1 if there is none
    bool   ok   = false;   // neighbour exists and is not on top of this node
    Vec    u;              // unit vector from this node to the neighbour
    double len  = 0.0;     // distance to the neighbour
};

struct NodeInfo
{
    NodeType type = NodeType::Corner;
    Link     link[2];                   // indexed by PREV, NEXT

    // Smooth nodes: the direction of travel at the node, if the neighbours
    // give one. Without one, each handle lies along its own chord.
    bool hasHeading = false;
    Vec  heading;

    // Tangent nodes, per side: the direction the handle points, and whether
    // a handle exists there.
    bool hasAxis[2];
    Vec  axis[2];
    bool present[2];

    NodeInfo()
    {
        for (int s = PREV; s <= NEXT; ++s) hasAxis[s] = present[s] = false;
    }
};

bool is_loop(const Path& path)
{
    return path.close() != Close::Open && path.nodes.size() >= 2;
}

// A closed path of exactly two nodes: each node has the other on both sides.
bool is_two_node_loop(const Path& path)
{
    return is_loop(path) && path.nodes.size() == 2;
}

// The start node of a path closed with the modifier.
bool is_modifier_start(const Path& path, int i)
{
    return i == 0 && is_loop(path) && path.close() == Close::Modifier;
}

int neighbour(int i, int n, bool loop, int step)
{
    const int j = i + step;
    if (j >= 0 && j < n) return j;
    return loop ? (j + n) % n : -1;
}

Link make_link(const Path& path, int i, int j)
{
    Link l;
    l.node = j;
    if (j < 0) return l;
    const Node& a = path.nodes[i];
    const Node& b = path.nodes[j];
    const Vec d(b.x - a.x, b.y - a.y);
    l.len = std::hypot(d.x, d.y);
    if (l.len < EPS) return l;
    l.u  = (1.0 / l.len) * d;
    l.ok = true;
    return l;
}

// Heading at the node of the circle through prev, node and next, pointing
// from prev toward next. Inverting about the node turns that circle into
// a line, which gives
//     heading  ~  u_next / |next|  -  u_prev / |prev|
// Equal distances reduce this to "from prev toward next". A missing
// neighbour contributes nothing, so an end node gets its chord direction.
// False if there is no such circle: the node has no neighbour, or prev and
// next are the same point (the path goes out and comes straight back). The
// threshold scales with the distances, so the answer does not depend on the
// size of the drawing.
bool circle_heading(const Link& prev, const Link& next, Vec& h)
{
    Vec    v;
    double scale = 0.0;
    if (next.ok) { v = v + (1.0 / next.len) * next.u;  scale += 1.0 / next.len; }
    if (prev.ok) { v = v - (1.0 / prev.len) * prev.u;  scale += 1.0 / prev.len; }
    if (scale == 0.0 || !normalise(v, EPS * scale)) return false;
    h = v;
    return true;
}

// Heading implied by a handle the user dragged on a Smooth node.
bool manual_heading(const Node& nd, Vec& h)
{
    Vec out(nd.hx_out, nd.hy_out);
    Vec in(-nd.hx_in, -nd.hy_in);
    if (nd.manual_out && normalise(out, EPS)) { h = out;  return true; }
    if (nd.manual_in  && normalise(in,  EPS)) { h = in;   return true; }
    return false;
}

// True if the handle h lies on its chord: no sideways part, pointing at the
// neighbour rather than away, and no longer than the chord itself. A side
// with no handle qualifies. Both ends of a segment like this draw a straight
// line. `dir` is the unit vector from the handle's node toward the other end.
bool on_chord(Vec h, Vec dir, double len)
{
    const double along  = dot(h, dir);
    const double across = h.x * dir.y - h.y * dir.x;
    return std::fabs(across) <= EPS * len
        && along >= -EPS * len && along <= len;
}

// Reflect direction s across the line along c (c may point either way).
Vec reflect(Vec s, Vec c)
{
    return (2.0 * dot(s, c)) * c - s;
}

void resolve_smooth(const Path& path, NodeInfo& me, int i)
{
    Vec h;
    if (manual_heading(path.nodes[i], h)
        || circle_heading(me.link[PREV], me.link[NEXT], h)) {
        me.heading    = h;
        me.hasHeading = true;
        return;
    }
    // A closed path of two nodes has no circle through three points. Take the
    // circle that has the chord as its diameter: the heading is square to the
    // chord, and the two nodes draw an ellipse. Nowhere else: two separate
    // nodes that happen to coincide leave this node with no heading.
    if (is_two_node_loop(path) && me.link[PREV].ok) {
        me.heading    = Vec(-me.link[PREV].u.y, me.link[PREV].u.x);
        me.hasHeading = true;
    }
}

// True if there is a handle at all. (0, 0) means the side is straight.
bool has_handle(double hx, double hy)
{
    return std::hypot(hx, hy) > EPS;
}

// True if the user dragged the handle on that side of the node.
bool dragged(const Node& nd, int side)
{
    const bool   manual = (side == PREV) ? nd.manual_in : nd.manual_out;
    const double hx     = (side == PREV) ? nd.hx_in : nd.hx_out;
    const double hy     = (side == PREV) ? nd.hy_in : nd.hy_out;
    return manual && has_handle(hx, hy);
}

// True if node j curves the segment on its given side by a handle that does
// not depend on its neighbours: a Smooth node always has one, and any node
// may have a dragged one. (A handle that is itself derived from a neighbour
// does not count, or two nodes would wait for each other.)
bool curves_segment(const Path& path, const std::vector<NodeInfo>& info, int j, int side)
{
    return info[j].type == NodeType::Smooth || dragged(path.nodes[j], side);
}

// The direction of each handle of a Tangent node, and which handles exist.
// Needs the types and links of every node.
void resolve_tangent(const Path& path, std::vector<NodeInfo>& info, int i)
{
    NodeInfo&   me = info[i];
    const Node& nd = path.nodes[i];

    for (int side = PREV; side <= NEXT; ++side) {
        const Link& toward = me.link[side];
        const Link& other  = me.link[1 - side];

        // Continue the chord on the other side; at an end, use our own.
        if (other.ok)       { me.hasAxis[side] = true;  me.axis[side] = (-1.0) * other.u; }
        else if (toward.ok) { me.hasAxis[side] = true;  me.axis[side] = toward.u; }
        else continue;

        const bool automatic = toward.ok && curves_segment(path, info, toward.node, 1 - side);
        me.present[side] = dragged(nd, side) || automatic;
    }
}

std::vector<NodeInfo> analyse(const Path& path)
{
    const int  n    = (int)path.nodes.size();
    const bool loop = is_loop(path);

    std::vector<NodeInfo> info(n);
    for (int i = 0; i < n; ++i) {
        info[i].type       = path.nodes[i].type;
        info[i].link[PREV] = make_link(path, i, neighbour(i, n, loop, -1));
        info[i].link[NEXT] = make_link(path, i, neighbour(i, n, loop, +1));
    }
    for (int i = 0; i < n; ++i) {
        if (info[i].type == NodeType::Smooth)  resolve_smooth(path, info[i], i);
        if (info[i].type == NodeType::Tangent) resolve_tangent(path, info, i);
    }
    return info;
}

// Direction of travel implied by a Tangent handle: the handle points along it
// on the NEXT side and against it on the PREV side.
Vec travel(const NodeInfo& n, int side)
{
    return (side == PREV ? -1.0 : 1.0) * n.axis[side];
}

// Direction of travel of a handle that lies along its own chord, pointing
// straight at the neighbour on that side.
Vec along_chord(const Link& l, int side)
{
    return (side == PREV ? -1.0 : 1.0) * l.u;
}

// Direction of travel that the handle on `side` of node i follows (the
// handle itself points along d on the NEXT side, against d on the PREV
// side). False if that side has no handle.
bool handle_direction(const Path& path, const std::vector<NodeInfo>& info,
                      int i, int side, Vec& d)
{
    const NodeInfo& me = info[i];
    const Link&     l  = me.link[side];

    if (me.type == NodeType::Tangent) {
        if (!me.present[side]) return false;
        d = travel(me, side);
        return true;
    }

    if (!l.ok) return false;

    if (me.type == NodeType::Smooth) {
        // Without a heading (the neighbours coincide), lie along the chord.
        d = me.hasHeading ? me.heading : along_chord(l, side);
        return true;
    }

    // Corner. The start node of a modifier-closed path always reaches straight
    // back to the last node, whatever that node is doing.
    if (side == PREV && is_modifier_start(path, i)) {
        d = along_chord(l, side);
        return true;
    }

    // A cusp follows nothing: each of its handles lies along its own chord.
    if (path.nodes[i].cusp) {
        d = along_chord(l, side);
        return true;
    }

    // Continue a Smooth neighbour's arc. A Tangent's handle is never followed,
    // even one the user pulled out: it bends only its own end of the segment.
    const NodeInfo& nb = info[l.node];
    if (nb.type == NodeType::Smooth && nb.hasHeading) {
        d = reflect(nb.heading, l.u);
        return true;
    }

    // Nothing to follow, so lie along the chord. The side stays a straight
    // line, and the user has a handle there to pull.
    d = along_chord(l, side);
    return true;
}

}   // namespace

bool close_path(Path& path, bool withModifier)
{
    if (path.nodes.size() < 2) return false;
    path.close_ = withModifier ? Close::Modifier : Close::Plain;

    Node& start = path.nodes[0];
    if (withModifier && start.type != NodeType::Corner) {
        start.type = NodeType::Corner;
        start.cusp = true;
    }
    return true;
}

void set_node_type(Path& path, int index, NodeType type, const Options& opts)
{
    if (index < 0 || index >= (int)path.nodes.size()) return;
    Node& nd = path.nodes[index];
    if (nd.type == type) return;

    // A Tangent's handles are the node's own: its rule placed them, and they
    // survive the move to a cusp. A Smooth node's handles belong to the curve
    // running through it, not to the node, so they do not, and the cusp falls
    // back to its default of lying along the chords. The start node of a
    // modifier-closed path keeps nothing either: its handles come from the
    // close, and the close reasserts them.
    const bool keep = type == NodeType::Corner
                      && nd.type == NodeType::Tangent
                      && !is_modifier_start(path, index);

    // The type changed, so a node becoming a Corner was curved: a cusp.
    nd.type       = type;
    nd.cusp       = (type == NodeType::Corner);
    nd.manual_in  = keep && has_handle(nd.hx_in,  nd.hy_in);
    nd.manual_out = keep && has_handle(nd.hx_out, nd.hy_out);
    compute_handles(path, opts);
}

void compute_handles(Path& path, const Options& opts)
{
    const std::vector<NodeInfo> info = analyse(path);

    for (int i = 0; i < (int)path.nodes.size(); ++i) {
        Node& nd = path.nodes[i];

        for (int side = PREV; side <= NEXT; ++side) {
            const bool isIn   = (side == PREV);
            double&    hx     = isIn ? nd.hx_in : nd.hx_out;
            double&    hy     = isIn ? nd.hy_in : nd.hy_out;
            bool&      manual = isIn ? nd.manual_in : nd.manual_out;

            // A manual handle stays as the user left it, except that a
            // Tangent node still decides the direction.
            if (manual && info[i].type != NodeType::Tangent) continue;

            Vec d;
            if (!handle_direction(path, info, i, side, d)) {
                hx = hy = 0.0;
                manual  = false;
                continue;
            }

            double len = opts.handleFraction * info[i].link[side].len;
            if (manual && has_handle(hx, hy)) len = std::hypot(hx, hy);

            hx = (isIn ? -d.x : d.x) * len;
            hy = (isIn ? -d.y : d.y) * len;
        }
    }
}

bool handle_axis(const Path& path, int index, bool isIn,
                 double& ax, double& ay)
{
    if (index < 0 || index >= (int)path.nodes.size()) return false;

    const std::vector<NodeInfo> info = analyse(path);
    const NodeInfo& me   = info[index];
    const int       side = isIn ? PREV : NEXT;
    if (!me.hasAxis[side]) return false;

    ax = me.axis[side].x;
    ay = me.axis[side].y;
    return true;
}

bool segment_is_straight(const Path& path, int index)
{
    const int n = (int)path.nodes.size();
    if (index < 0 || index >= n) return false;
    const int j = neighbour(index, n, is_loop(path), +1);
    if (j < 0) return false;                  // no segment starts here

    const Link l = make_link(path, index, j);
    if (!l.ok) return true;                   // the two nodes are in one place

    const Node& a = path.nodes[index];
    const Node& b = path.nodes[j];
    return on_chord(Vec(a.hx_out, a.hy_out),       l.u, l.len)
        && on_chord(Vec(b.hx_in,  b.hy_in), -1.0 * l.u, l.len);
}

void drag_handle(Path& path, int index, bool isIn, double x, double y,
                 const Options& opts)
{
    if (index < 0 || index >= (int)path.nodes.size()) return;
    Node& nd = path.nodes[index];

    double& hx   = isIn ? nd.hx_in  : nd.hx_out;    // the handle being dragged
    double& hy   = isIn ? nd.hy_in  : nd.hy_out;
    double& ox   = isIn ? nd.hx_out : nd.hx_in;     // the opposite handle
    double& oy   = isIn ? nd.hy_out : nd.hy_in;
    bool&   man  = isIn ? nd.manual_in  : nd.manual_out;
    bool&   oman = isIn ? nd.manual_out : nd.manual_in;

    const NodeType type = nd.type;

    hx  = x - nd.x;
    hy  = y - nd.y;
    man = true;

    if (type == NodeType::Smooth) {
        const double len = std::hypot(hx, hy), oppLen = std::hypot(ox, oy);
        if (len > EPS && oppLen > EPS) {
            ox   = -hx / len * oppLen;
            oy   = -hy / len * oppLen;
            oman = true;
        }
    }
    // Re-aims a Tangent handle, and clears one that has no direction to take.
    compute_handles(path, opts);
}

}   // namespace bezigon
