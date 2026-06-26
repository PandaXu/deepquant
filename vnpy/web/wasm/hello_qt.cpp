#include <QApplication>
#include <QMainWindow>
#include <QLabel>

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);

    QMainWindow win;
    win.resize(800, 600);
    win.setWindowTitle("VeighNa Qt6 WASM");

    QLabel* label = new QLabel("HELLO QT6 WASM!");
    label->setAlignment(Qt::AlignCenter);
    label->setStyleSheet("color: #58a6ff; font-size: 32px; font-weight: bold; background: #1e1e1e;");

    win.setCentralWidget(label);
    win.setStyleSheet("background-color: #1e1e1e;");
    win.show();

    return app.exec();
}
