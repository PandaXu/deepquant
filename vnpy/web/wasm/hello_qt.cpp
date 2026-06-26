#include <QApplication>
#include <QMainWindow>
#include <QLabel>
#include <QVBoxLayout>

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);

    QMainWindow win;
    win.setWindowTitle("VeighNa Qt6 WASM");
    win.resize(800, 600);

    QLabel* label = new QLabel(
        "<h1 style='color:#58a6ff'>Hello Qt6 WASM!</h1>"
        "<p style='color:#d4d4d4'>C++ Widgets running in WebAssembly</p>"
    );
    label->setAlignment(Qt::AlignCenter);
    win.setCentralWidget(label);

    win.setStyleSheet("background-color: #1e1e1e;");
    win.show();

    return app.exec();
}
